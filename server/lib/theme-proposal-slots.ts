import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import { factScopeSchema, type FactScope } from '@shared/models/theme-evidence';

import {
  ThemeFactDerivationError,
  themeFactDerivationPolicySchema,
  validateThemeFactProposal,
} from './theme-fact-derivation';
import { themeLiveRuntimePlanV2Schema, type ThemeLiveRuntimePlanV2 } from './theme-runtime-plan';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const uuidSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const versionSchema = z.string().trim().min(1).max(255);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function normalizeText(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeThemeFactScope(input: FactScope): FactScope {
  const parsed = factScopeSchema.parse(input);
  const required = (value: string) => {
    const normalized = normalizeText(value);
    if (!normalized) throw new ThemeProposalSlotError('invalid_proposal');
    return normalized;
  };
  const optional = (value: string | null) => (value === null ? null : required(value));
  return factScopeSchema.parse({
    entity: required(parsed.entity),
    relation: required(parsed.relation),
    time: optional(parsed.time),
    geography: optional(parsed.geography),
    competitionOrDomain: optional(parsed.competitionOrDomain),
    qualifiers: Array.from(new Set(parsed.qualifiers.map(required))).sort(),
    asOf: parsed.asOf === null ? null : new Date(parsed.asOf).toISOString(),
  });
}

export function deriveCanonicalThemeFactKey(input: FactScope): string {
  return `fact-scope-v1:${hash(normalizeThemeFactScope(input))}`;
}

const citationSchema = z
  .object({
    passageId: uuidSchema,
    passageContentHash: sha256Schema,
    supportKind: z.enum(['supports', 'conflicts', 'context']),
  })
  .strict();

const proposedSchema = z
  .object({
    status: z.literal('proposed'),
    statement: z.string().trim().min(1).max(4_000),
    scope: factScopeSchema,
    canonicalAnswer: z.string().trim().min(1).max(1_000),
    supportedAliases: z.array(z.string().trim().min(1).max(1_000)).max(50),
    timeSensitive: z.boolean(),
    citations: z.array(citationSchema).min(1).max(12),
  })
  .strict();

const withheldSchema = z
  .object({
    status: z.literal('withheld'),
    reason: z.enum(['insufficient_evidence', 'conflicted', 'invalid_output', 'policy_unsatisfied']),
  })
  .strict();

const outcomeSchema = z.discriminatedUnion('status', [proposedSchema, withheldSchema]);
const persistedOutcomeSchema = z.discriminatedUnion('status', [
  proposedSchema.extend({ validUntil: z.string().datetime().nullable() }).strict(),
  withheldSchema,
]);
const provenanceSchema = z
  .object({
    proposalPolicyVersion: versionSchema,
    promptVersion: versionSchema,
    promptHash: sha256Schema,
    producerKind: z.enum(['model', 'human']),
    producerId: versionSchema,
    provider: versionSchema.nullable(),
    model: versionSchema.nullable(),
    claimRisks: z
      .array(z.enum(['stable', 'timeSensitive', 'superlative', 'disputed']))
      .min(1)
      .max(4),
    derivationPolicy: themeFactDerivationPolicySchema,
  })
  .strict()
  .superRefine((value, context) => {
    const validFields =
      value.producerKind === 'model'
        ? value.provider !== null && value.model !== null
        : value.provider === null && value.model === null;
    if (!validFields)
      context.addIssue({ code: 'custom', message: 'Producer fields do not match producer kind' });
    if (
      new Set(value.claimRisks).size !== value.claimRisks.length ||
      (value.claimRisks.includes('stable') && value.claimRisks.length !== 1)
    )
      context.addIssue({ code: 'custom', message: 'Claim risks must be unique and compatible' });
  });

export type ThemeProposalSlotOutcome = z.input<typeof outcomeSchema>;
export type ThemeProposalSlotProvenance = z.input<typeof provenanceSchema>;

export type PersistedThemeProposalSlotOutcome = Readonly<{
  replay: boolean;
  status: 'proposed' | 'withheld';
  canonicalFactKey: string | null;
  resultHash: string;
}>;

export class ThemeProposalSlotError extends Error {
  constructor(
    public readonly code:
      | 'invalid_plan'
      | 'plan_conflict'
      | 'slot_conflict'
      | 'slot_missing'
      | 'invalid_proposal'
      | 'evidence_conflict'
      | 'storage_failure'
  ) {
    super(code);
    this.name = 'ThemeProposalSlotError';
  }
}

type SlotRow = {
  slot_key: string;
  slot_ordinal: number;
  source_key: string;
  allocation_version: string;
  policy_snapshot: unknown;
  policy_hash: string;
};

type OutcomeRow = {
  status: 'proposed' | 'withheld';
  outcome_snapshot: unknown;
  evidence_fingerprint: string;
  provenance_snapshot: unknown;
  provenance_fingerprint: string;
  canonical_fact_key: string | null;
  result_hash: string;
};

type EvidenceRow = {
  id: string;
  content_hash: string;
  canonical_url: string;
  final_url: string;
  status: string;
  source_class: string;
  origin_group: string;
  source_policy_version: string;
  retrieved_at: Date;
  valid_until: Date | null;
  registry_hash: string | null;
};

type LockedSlotRow = {
  slot_key: string;
  source_key: string;
  plan_json: unknown;
};

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect().catch(() => {
    throw new ThemeProposalSlotError('storage_failure');
  });
  let committing = false;
  let discard = false;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    committing = true;
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (committing) discard = true;
    else
      try {
        await client.query('ROLLBACK');
      } catch {
        discard = true;
      }
    if (error instanceof ThemeProposalSlotError) throw error;
    throw new ThemeProposalSlotError('storage_failure');
  } finally {
    client.release(discard);
  }
}

function normalizeOutcome(raw: ThemeProposalSlotOutcome) {
  const parsed = outcomeSchema.safeParse(raw);
  if (!parsed.success) throw new ThemeProposalSlotError('invalid_proposal');
  if (parsed.data.status === 'withheld') return parsed.data;
  const scope = normalizeThemeFactScope(parsed.data.scope);
  const citations = [...parsed.data.citations].sort((left, right) =>
    left.passageId.localeCompare(right.passageId)
  );
  if (
    new Set(citations.map((citation) => citation.passageId)).size !== citations.length ||
    !citations.some((citation) => citation.supportKind === 'supports')
  )
    throw new ThemeProposalSlotError('invalid_proposal');
  const answer = parsed.data.canonicalAnswer.normalize('NFC').trim();
  const aliases = Array.from(
    new Set(parsed.data.supportedAliases.map((value) => value.normalize('NFC').trim()))
  )
    .filter((value) => value && value !== answer)
    .sort();
  return {
    ...parsed.data,
    statement: parsed.data.statement.normalize('NFC').trim(),
    scope,
    canonicalAnswer: answer,
    supportedAliases: aliases,
    citations,
  };
}

function sameSlots(rows: SlotRow[], plan: ThemeLiveRuntimePlanV2): boolean {
  const policyHash = hash(plan.proposalSlotPolicy);
  return (
    rows.length === plan.proposalSlots.length &&
    rows.every((row, index) => {
      const expected = plan.proposalSlots[index];
      return (
        row.slot_key === expected.key &&
        row.slot_ordinal === expected.ordinal &&
        row.source_key === expected.sourceKey &&
        row.allocation_version === plan.proposalSlotPolicy.allocationVersion &&
        canonical(row.policy_snapshot) === canonical(plan.proposalSlotPolicy) &&
        row.policy_hash === policyHash
      );
    })
  );
}

export function createThemeProposalSlotRepository(pool: Pool, options: { now?: () => Date } = {}) {
  const now = options.now ?? (() => new Date());

  function readStoredOutcome(row: OutcomeRow, replay: boolean) {
    const outcome = persistedOutcomeSchema.safeParse(row.outcome_snapshot);
    const provenance = provenanceSchema.safeParse(row.provenance_snapshot);
    if (!outcome.success || !provenance.success) throw new ThemeProposalSlotError('slot_conflict');
    const canonicalFactKey =
      outcome.data.status === 'proposed' ? deriveCanonicalThemeFactKey(outcome.data.scope) : null;
    const provenanceFingerprint = hash(provenance.data);
    const resultHash = hash({
      outcome: outcome.data,
      evidenceFingerprint: row.evidence_fingerprint,
      provenanceFingerprint,
      canonicalFactKey,
    });
    if (
      row.status !== outcome.data.status ||
      row.provenance_fingerprint !== provenanceFingerprint ||
      row.canonical_fact_key !== canonicalFactKey ||
      row.result_hash !== resultHash
    )
      throw new ThemeProposalSlotError('slot_conflict');
    return {
      replay,
      status: outcome.data.status,
      canonicalFactKey,
      resultHash,
      outcome: outcome.data,
      provenance: provenance.data,
      evidenceFingerprint: row.evidence_fingerprint,
    } as const;
  }

  return {
    async allocate(input: {
      jobId: string;
      planHash: string;
      plan: ThemeLiveRuntimePlanV2;
    }): Promise<{ replay: boolean; allocated: number }> {
      const parsedPlan = themeLiveRuntimePlanV2Schema.safeParse(input.plan);
      if (
        !uuidSchema.safeParse(input.jobId).success ||
        !sha256Schema.safeParse(input.planHash).success ||
        !parsedPlan.success
      )
        throw new ThemeProposalSlotError('invalid_plan');
      const plan = parsedPlan.data;
      return transaction(pool, async (client) => {
        const job = await client.query<{ plan_hash: string | null; plan_json: unknown }>(
          'SELECT plan_hash,plan_json FROM theme_preparation_jobs WHERE id=$1 FOR UPDATE',
          [input.jobId]
        );
        if (
          job.rows[0]?.plan_hash !== input.planHash ||
          canonical(job.rows[0]?.plan_json) !== canonical(plan)
        )
          throw new ThemeProposalSlotError('plan_conflict');
        const before = await client.query<SlotRow>(
          `SELECT slot_key,slot_ordinal,source_key,allocation_version,policy_snapshot,policy_hash
             FROM theme_proposal_slots WHERE job_id=$1 ORDER BY slot_ordinal`,
          [input.jobId]
        );
        if (before.rows.length) {
          if (!sameSlots(before.rows, plan)) throw new ThemeProposalSlotError('slot_conflict');
          return { replay: true, allocated: before.rows.length };
        }
        const policyHash = hash(plan.proposalSlotPolicy);
        for (const slot of plan.proposalSlots)
          await client.query(
            `INSERT INTO theme_proposal_slots
             (job_id,plan_hash,slot_key,slot_ordinal,source_key,allocation_version,policy_snapshot,policy_hash)
             VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
            [
              input.jobId,
              input.planHash,
              slot.key,
              slot.ordinal,
              slot.sourceKey,
              plan.proposalSlotPolicy.allocationVersion,
              JSON.stringify(plan.proposalSlotPolicy),
              policyHash,
            ]
          );
        return { replay: false, allocated: plan.proposalSlots.length };
      });
    },

    async recordOutcome(input: {
      jobId: string;
      slotKey: string;
      outcome: ThemeProposalSlotOutcome;
      provenance: ThemeProposalSlotProvenance;
    }): Promise<PersistedThemeProposalSlotOutcome> {
      if (!uuidSchema.safeParse(input.jobId).success)
        throw new ThemeProposalSlotError('invalid_proposal');
      const provenance = provenanceSchema.safeParse(input.provenance);
      if (!provenance.success) throw new ThemeProposalSlotError('invalid_proposal');
      const outcome = normalizeOutcome(input.outcome);
      return transaction(pool, async (client) => {
        const slot = await client.query<LockedSlotRow>(
          `SELECT s.slot_key,s.source_key,j.plan_json
             FROM theme_proposal_slots s
             JOIN theme_preparation_jobs j ON j.id=s.job_id
            WHERE s.job_id=$1 AND s.slot_key=$2 FOR UPDATE OF s`,
          [input.jobId, input.slotKey]
        );
        const lockedSlot = slot.rows[0];
        if (!lockedSlot) throw new ThemeProposalSlotError('slot_missing');
        const plan = themeLiveRuntimePlanV2Schema.safeParse(lockedSlot.plan_json);
        if (!plan.success) throw new ThemeProposalSlotError('plan_conflict');
        const source = plan.data.sources.find((item) => item.key === lockedSlot.source_key);
        if (!source) throw new ThemeProposalSlotError('plan_conflict');
        let persistedOutcome: unknown = outcome;
        let evidenceFingerprint = hash([]);
        if (outcome.status === 'proposed') {
          let validated;
          try {
            validated = await validateThemeFactProposal(client, {
              proposal: outcome,
              passageIds: outcome.citations.map((citation) => citation.passageId),
              policy: provenance.data.derivationPolicy,
              now: now(),
            });
          } catch (error) {
            if (error instanceof ThemeFactDerivationError)
              throw new ThemeProposalSlotError('evidence_conflict');
            throw new ThemeProposalSlotError('storage_failure');
          }
          if (validated.result.status !== 'proposed' || !validated.result.policySatisfied)
            throw new ThemeProposalSlotError('evidence_conflict');
          persistedOutcome = {
            status: 'proposed' as const,
            ...validated.result.snapshot,
            scope: normalizeThemeFactScope(validated.result.snapshot.scope),
            citations: validated.result.citations,
          };
          const passages = await client.query<EvidenceRow>(
            `SELECT p.id,p.content_hash,d.canonical_url,d.final_url,d.status,d.source_class,
                    d.origin_group,d.source_policy_version,d.retrieved_at,d.valid_until,
                    s.registry_hash
               FROM theme_evidence_passages p
               JOIN theme_evidence_documents d ON d.id=p.document_id
               LEFT JOIN theme_evidence_document_sources s ON s.document_id=d.id
              WHERE p.id=ANY($1::uuid[]) ORDER BY p.id`,
            [outcome.citations.map((citation) => citation.passageId)]
          );
          if (
            passages.rows.length !== outcome.citations.length ||
            passages.rows.some(
              (row, index) =>
                row.id.toLowerCase() !== outcome.citations[index].passageId ||
                row.content_hash !== outcome.citations[index].passageContentHash
            )
          )
            throw new ThemeProposalSlotError('evidence_conflict');
          const sourceUrls = new Map(
            plan.data.sources.map((item) => [item.canonicalUrl, item.key] as const)
          );
          const supports = passages.rows.filter(
            (_row, index) => outcome.citations[index].supportKind === 'supports'
          );
          const claimPolicies = provenance.data.claimRisks.map(
            (risk) => plan.data.claimEvidencePolicy[risk]
          );
          const allowedSourceClasses = claimPolicies[0].allowedSourceClasses.filter((sourceClass) =>
            claimPolicies.every((policy) => policy.allowedSourceClasses.includes(sourceClass))
          );
          const minimumOriginGroups = Math.max(
            ...claimPolicies.map((policy) => policy.minimumIndependentOriginGroups)
          );
          if (
            provenance.data.claimRisks.includes('timeSensitive') !== outcome.timeSensitive ||
            provenance.data.derivationPolicy.sourcePolicyVersion !==
              plan.data.sourcePolicyVersion ||
            canonical(provenance.data.derivationPolicy.allowedSourceClasses.slice().sort()) !==
              canonical(allowedSourceClasses.slice().sort()) ||
            provenance.data.derivationPolicy.minimumOriginGroups !== minimumOriginGroups ||
            passages.rows.some(
              (row) =>
                !sourceUrls.has(row.canonical_url) ||
                row.registry_hash !== plan.data.sourceRegistryHash
            ) ||
            !supports.some((row) => sourceUrls.get(row.canonical_url) === lockedSlot.source_key) ||
            claimPolicies.some(
              (policy) =>
                policy.atLeastOneFromSourceClasses.length > 0 &&
                !supports.some((row) =>
                  policy.atLeastOneFromSourceClasses.includes(row.source_class as never)
                )
            )
          )
            throw new ThemeProposalSlotError('evidence_conflict');
          evidenceFingerprint = validated.evidenceFingerprint;
        }
        const canonicalFactKey =
          outcome.status === 'proposed'
            ? deriveCanonicalThemeFactKey((persistedOutcome as { scope: FactScope }).scope)
            : null;
        const provenanceFingerprint = hash(provenance.data);
        const resultHash = hash({
          outcome: persistedOutcome,
          evidenceFingerprint,
          provenanceFingerprint,
          canonicalFactKey,
        });
        const inserted = await client.query(
          `INSERT INTO theme_proposal_slot_outcomes
           (job_id,slot_key,status,outcome_snapshot,evidence_fingerprint,provenance_snapshot,
            provenance_fingerprint,canonical_fact_key,result_hash)
           VALUES($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8,$9)
           ON CONFLICT DO NOTHING`,
          [
            input.jobId,
            input.slotKey,
            outcome.status,
            JSON.stringify(persistedOutcome),
            evidenceFingerprint,
            JSON.stringify(provenance.data),
            provenanceFingerprint,
            canonicalFactKey,
            resultHash,
          ]
        );
        const stored = await client.query<OutcomeRow>(
          'SELECT * FROM theme_proposal_slot_outcomes WHERE job_id=$1 AND slot_key=$2',
          [input.jobId, input.slotKey]
        );
        const row = stored.rows[0];
        if (
          !row ||
          row.status !== outcome.status ||
          canonical(row.outcome_snapshot) !== canonical(persistedOutcome) ||
          row.evidence_fingerprint !== evidenceFingerprint ||
          canonical(row.provenance_snapshot) !== canonical(provenance.data) ||
          row.provenance_fingerprint !== provenanceFingerprint ||
          row.canonical_fact_key !== canonicalFactKey ||
          row.result_hash !== resultHash
        )
          throw new ThemeProposalSlotError('slot_conflict');
        return {
          replay: inserted.rowCount === 0,
          status: outcome.status,
          canonicalFactKey,
          resultHash,
        };
      });
    },

    async loadOutcome(input: { jobId: string; slotKey: string }) {
      if (!uuidSchema.safeParse(input.jobId).success)
        throw new ThemeProposalSlotError('invalid_proposal');
      const slot = await pool.query(
        'SELECT slot_key FROM theme_proposal_slots WHERE job_id=$1 AND slot_key=$2',
        [input.jobId, input.slotKey]
      );
      if (!slot.rows[0]) throw new ThemeProposalSlotError('slot_missing');
      const stored = await pool.query<OutcomeRow>(
        'SELECT * FROM theme_proposal_slot_outcomes WHERE job_id=$1 AND slot_key=$2',
        [input.jobId, input.slotKey]
      );
      return stored.rows[0] ? readStoredOutcome(stored.rows[0], true) : null;
    },
  };
}
