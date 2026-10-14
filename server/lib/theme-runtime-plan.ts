import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';

const sourceItemSchema = z
  .object({
    key: z.string().trim().min(1).max(255),
    ordinal: z.number().int().positive().max(100),
    requestedUrl: z
      .string()
      .url()
      .refine((value) => value.startsWith('https://')),
    title: z.string().trim().min(1).max(500),
    language: z.string().trim().min(2).max(35),
    canonicalFactKey: z.string().trim().min(1).max(255),
    expectedLatestFactRevision: z.number().int().nonnegative(),
  })
  .strict();

export const themePreviewRuntimePlanSchema = z
  .object({
    contractVersion: z.literal('theme-preview-runtime-plan-v1'),
    mode: z.literal('offline_fixture'),
    fixtureVersion: z.string().trim().min(1).max(64),
    sourcePolicyVersion: z.string().trim().min(1).max(255),
    budgetPolicyFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    items: z.array(sourceItemSchema).min(1).max(100),
  })
  .strict()
  .superRefine((plan, context) => {
    if (new Set(plan.items.map((item) => item.key)).size !== plan.items.length)
      context.addIssue({ code: 'custom', path: ['items'], message: 'Item keys must be unique' });
    if (new Set(plan.items.map((item) => item.ordinal)).size !== plan.items.length)
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Item ordinals must be unique',
      });
  });

export type ThemePreviewRuntimePlan = z.infer<typeof themePreviewRuntimePlanSchema>;

export class ThemeRuntimePlanError extends Error {
  constructor(
    public readonly code: 'invalid_plan' | 'plan_conflict' | 'plan_missing',
    message: string
  ) {
    super(message);
    this.name = 'ThemeRuntimePlanError';
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export function hashThemeRuntimePlan(input: {
  planVersion: string;
  plan: ThemePreviewRuntimePlan;
  holdUntil: Date;
}): string {
  return createHash('sha256')
    .update(
      canonical({
        planVersion: input.planVersion,
        plan: input.plan,
        holdUntil: input.holdUntil.toISOString(),
      })
    )
    .digest('hex');
}

function parse(input: { planVersion: string; plan: unknown; holdUntil: Date }): {
  planVersion: string;
  plan: ThemePreviewRuntimePlan;
  holdUntil: Date;
  planHash: string;
} {
  const planVersion = input.planVersion.trim();
  const parsed = themePreviewRuntimePlanSchema.safeParse(input.plan);
  if (
    !planVersion ||
    planVersion.length > 64 ||
    !parsed.success ||
    !(input.holdUntil instanceof Date) ||
    !Number.isFinite(input.holdUntil.valueOf())
  )
    throw new ThemeRuntimePlanError('invalid_plan', 'Invalid preview runtime plan');
  const value = { planVersion, plan: parsed.data, holdUntil: new Date(input.holdUntil) };
  return { ...value, planHash: hashThemeRuntimePlan(value) };
}

type PlanRow = {
  plan_version: string | null;
  plan_hash: string | null;
  plan_json: unknown;
  plan_hold_until: Date | null;
};

function fromRow(row: PlanRow | undefined) {
  if (!row?.plan_version || !row.plan_hash || !row.plan_hold_until)
    throw new ThemeRuntimePlanError('plan_missing', 'Preparation job has no runtime plan');
  const value = parse({
    planVersion: row.plan_version,
    plan: row.plan_json,
    holdUntil: row.plan_hold_until,
  });
  if (value.planHash !== row.plan_hash)
    throw new ThemeRuntimePlanError('plan_conflict', 'Stored runtime plan hash does not match');
  return value;
}

export function createThemeRuntimePlanRepository(pool: Pool) {
  async function load(jobId: string) {
    const result = await pool.query<PlanRow>(
      `SELECT plan_version,plan_hash,plan_json,plan_hold_until
       FROM theme_preparation_jobs WHERE id=$1`,
      [jobId]
    );
    return fromRow(result.rows[0]);
  }

  return {
    async attach(
      jobId: string,
      input: { planVersion: string; plan: unknown; holdUntil: Date }
    ): Promise<{ replay: boolean; planHash: string }> {
      const value = parse(input);
      const result = await pool.query<PlanRow>(
        `UPDATE theme_preparation_jobs
         SET plan_version=$2,plan_hash=$3,plan_json=$4,plan_hold_until=$5,updated_at=clock_timestamp()
         WHERE id=$1 AND plan_version IS NULL
           AND status IN ('queued','waiting')
         RETURNING plan_version,plan_hash,plan_json,plan_hold_until`,
        [jobId, value.planVersion, value.planHash, value.plan, value.holdUntil]
      );
      if (result.rows[0]) return { replay: false, planHash: value.planHash };
      const existing = await load(jobId);
      if (
        existing.planVersion !== value.planVersion ||
        existing.planHash !== value.planHash ||
        existing.holdUntil.getTime() !== value.holdUntil.getTime()
      )
        throw new ThemeRuntimePlanError(
          'plan_conflict',
          'Preparation job already has a different runtime plan'
        );
      return { replay: true, planHash: value.planHash };
    },

    load,
  };
}
