import type { Express, Request, Response, NextFunction } from 'express';
import { enrichSubjectiveFindings } from './lib/subjectivity-enricher';
import type { Server } from 'http';
import { setupAuth, registerAuthRoutes, isAuthenticated } from './replit_integrations/auth';
import { db } from './db';
import {
  disputes,
  disputeBallots,
  adminRoles,
  publicDisputeRequestSchema,
  appConfig,
  questions,
  seenQuestions,
  insertQuestionSchema,
  questionEdits,
  questionQualitySweepDismissals,
  duplicatePairKey,
  isStaticFindingDismissed,
  type QuestionSnapshot,
} from '@shared/schema';
import { eq, and, sql, inArray, ne } from 'drizzle-orm';
import { analyzeDispute } from './lib/ai';
import { generateQuestions } from './lib/guardian';
import { getAiFieldFix, type FixableField } from './lib/field-fix';
import { auditQuestionQuality } from './lib/question-quality-audit';
import { detectDuplicates } from './lib/duplicate-detector';
import { batchFactCheck } from './lib/verifier';
import { selectTopicContext } from './lib/topic-context';
import { filterNovelQuestions } from './lib/novelty-filter';
import { z } from 'zod';
import { aiLimiter } from './middleware/rateLimiter';
import type { AuthenticatedRequest } from './types';
import { registerRoomRoutes } from './routes.rooms';

const VALID_PILLARS = ['GlobalEh', 'FreshPrints', 'TimeCapsule', 'GreatOutdoors'] as const;
type SinglePillar = (typeof VALID_PILLARS)[number];
const PILLAR_MIX: { pillar: SinglePillar; pct: number }[] = [
  { pillar: 'TimeCapsule', pct: 0.3 },
  { pillar: 'GlobalEh', pct: 0.3 },
  { pillar: 'FreshPrints', pct: 0.25 },
  { pillar: 'GreatOutdoors', pct: 0.15 },
];

function allocateMixed(count: number): { pillar: SinglePillar; count: number }[] {
  const items = PILLAR_MIX.map((t) => ({
    pillar: t.pillar,
    floored: Math.floor(t.pct * count),
    remainder: (t.pct * count) % 1,
    pct: t.pct,
  }));
  let remaining = count - items.reduce((s, t) => s + t.floored, 0);
  items.sort((a, b) => b.remainder - a.remainder || b.pct - a.pct);
  for (let i = 0; i < remaining; i++) items[i].floored++;
  return items.filter((t) => t.floored > 0).map((t) => ({ pillar: t.pillar, count: t.floored }));
}

const stagingGenerateSchema = z.object({
  topic: z.string().trim().min(1, 'Topic is required'),
  count: z.coerce.number().int().min(1).max(20),
  pillar: z.union([z.enum(VALID_PILLARS), z.literal('Mixed')]),
});

const disputeUpdateSchema = z
  .object({
    status: z.enum(['pending', 'resolved', 'rejected']).optional(),
    resolutionNote: z.string().max(2000).nullable().optional(),
    aiAnalysis: z.unknown().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one update field is required');

const adminGrantSchema = z
  .object({
    userId: z.string().trim().min(1).max(255),
  })
  .strict();

const appConfigUpdateSchema = z
  .object({
    key: z.enum(['openai_api_key', 'llm_provider']),
    value: z.string().trim().min(1).max(10000),
  })
  .strict();

const MAX_SEEN_QUESTION_IDS_PER_REQUEST = 500;

const seenQuestionsRequestSchema = z
  .object({
    questionIds: z.array(z.string().trim().min(1)).min(1).max(MAX_SEEN_QUESTION_IDS_PER_REQUEST),
  })
  .strict();

const questionEditableFieldsSchema = insertQuestionSchema
  .omit({ id: true, aiAnalysis: true })
  .extend({
    // Keep status validation explicit on PATCH payloads so invalid values are rejected
    // before hitting the database update.
    status: z.enum(['draft', 'pending', 'approved', 'rejected']).optional(),
  })
  .partial()
  .strict();

const questionPatchSchema = questionEditableFieldsSchema.refine(
  (value) => Object.keys(value).length > 0,
  'At least one update field is required'
);

const questionFieldPatchSchema = z
  .object({
    field: questionEditableFieldsSchema.keyof(),
    value: z.unknown(),
    aiSuggested: z.boolean().optional().default(false),
  })
  .strict();

const aiFixRequestSchema = z
  .object({
    field: z.enum([
      'sourceUrl',
      'sourceName',
      'explanation',
      'tags',
      'answer',
      'question',
      'acceptableAnswers',
    ]),
  })
  .strict();

function sendValidationError(res: Response, message: string, error: z.ZodError) {
  return res.status(422).json({ message, errors: error.errors });
}

function parseQuestionFieldPatch(body: unknown) {
  const parsed = questionFieldPatchSchema.parse(body);
  const fieldSchema = questionEditableFieldsSchema.shape[parsed.field];
  return {
    ...parsed,
    value: fieldSchema.parse(parsed.value),
  };
}

function getUserId(req: Request): string | undefined {
  return (req as AuthenticatedRequest).user?.claims?.sub;
}

async function isAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const [user] = await db.select().from(adminRoles).where(eq(adminRoles.userId, userId)).limit(1);

    if (!user) {
      return res.status(403).json({ message: 'Forbidden: Admin access required' });
    }

    next();
  } catch (error) {
    console.error('Error checking admin status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

// Sanitize source URL/name to a domain label (e.g. "Wikipedia") so the
// raw article title never reaches the client and can't leak the answer.
function extractSourceDomain(
  sourceUrl: string | null | undefined,
  sourceName: string | null | undefined
): string | null {
  if (!sourceUrl && !sourceName) return null;
  if (sourceUrl) {
    try {
      const hostname = new URL(sourceUrl).hostname.replace(/^www\./, '');
      if (hostname.includes('wikipedia.org')) return 'Wikipedia';
      if (hostname.includes('britannica.com')) return 'Britannica';
      if (hostname.includes('history.com')) return 'History.com';
      if (hostname.includes('nationalgeographic.com')) return 'National Geographic';
      return null;
    } catch {
      // URL parse failed — fall through to sourceName
    }
  }
  if (sourceName) {
    const KNOWN_PROVIDERS: [RegExp, string][] = [
      [/wikipedia/i, 'Wikipedia'],
      [/britannica/i, 'Britannica'],
      [/history\.com|history channel/i, 'History.com'],
      [/national\s*geographic/i, 'National Geographic'],
    ];
    for (const [pattern, label] of KNOWN_PROVIDERS) {
      if (pattern.test(sourceName)) return label;
    }
    return null;
  }
  return null;
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // Setup authentication (MUST be before other routes)
  await setupAuth(app);
  registerAuthRoutes(app);
  registerRoomRoutes(app);

  // Disputes API - admin review routes are protected; player submissions are public.
  app.get('/api/disputes', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const allDisputes = await db.select().from(disputes);
      if (allDisputes.length === 0) {
        return res.json([]);
      }

      // Ballots are admin-only. Fetch them in one bounded query instead of one
      // query per dispute, then attach at most the persisted rows for each ID.
      const disputeIds = allDisputes.map((dispute) => dispute.id);
      const allBallots = await db
        .select()
        .from(disputeBallots)
        .where(inArray(disputeBallots.disputeId, disputeIds));
      const ballotsByDispute = new Map<string, typeof allBallots>();

      for (const ballot of allBallots) {
        const ballots = ballotsByDispute.get(ballot.disputeId) ?? [];
        ballots.push(ballot);
        ballotsByDispute.set(ballot.disputeId, ballots);
      }

      res.json(
        allDisputes.map((dispute) => ({
          ...dispute,
          ballots: ballotsByDispute.get(dispute.id) ?? [],
        }))
      );
    } catch (error) {
      console.error('Error fetching disputes:', error);
      res.status(500).json({ message: 'Failed to fetch disputes' });
    }
  });

  app.post('/api/disputes', async (req, res) => {
    try {
      const parsed = publicDisputeRequestSchema.parse(req.body);
      const [newDispute] = await db.insert(disputes).values(parsed).returning();
      res.status(201).json(newDispute);
    } catch (error) {
      console.error('Error creating dispute:', error);
      const statusCode = error instanceof z.ZodError ? 422 : 400;
      res.status(statusCode).json({ message: 'Invalid dispute data' });
    }
  });

  // Analyze dispute with AI
  app.post('/api/disputes/:id/analyze', isAuthenticated, isAdmin, aiLimiter, async (req, res) => {
    try {
      const { id } = req.params;

      const [dispute] = await db.select().from(disputes).where(eq(disputes.id, id)).limit(1);

      if (!dispute) {
        return res.status(404).json({ message: 'Dispute not found' });
      }

      const analysis = await analyzeDispute(
        dispute.questionText,
        dispute.correctAnswer,
        dispute.submittedAnswer || '',
        dispute.teamExplanation
      );

      // Save analysis to DB
      await db.update(disputes).set({ aiAnalysis: analysis }).where(eq(disputes.id, id));

      res.json(analysis);
    } catch (error) {
      console.error('Error analyzing dispute:', error);
      res.status(500).json({ message: error instanceof Error ? error.message : 'Analysis failed' });
    }
  });

  // Update dispute status
  app.patch('/api/disputes/:id', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const parsed = disputeUpdateSchema.parse(req.body);

      const [updated] = await db
        .update(disputes)
        .set({
          ...parsed,
        })
        .where(eq(disputes.id, id))
        .returning();

      if (!updated) {
        return res.status(404).json({ message: 'Dispute not found' });
      }

      res.json(updated);
    } catch (error) {
      console.error('Error updating dispute:', error);
      if (error instanceof z.ZodError) {
        return sendValidationError(res, 'Invalid dispute update', error);
      }
      res.status(500).json({ message: 'Failed to update dispute' });
    }
  });

  app.delete('/api/disputes', isAuthenticated, isAdmin, async (req, res) => {
    try {
      await db.delete(disputes);
      res.json({ message: 'All disputes cleared' });
    } catch (error) {
      console.error('Error clearing disputes:', error);
      res.status(500).json({ message: 'Failed to clear disputes' });
    }
  });

  // Admin management routes
  app.post('/api/admin/grant', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const { userId } = adminGrantSchema.parse(req.body);
      const grantedBy = getUserId(req);

      await db.insert(adminRoles).values({
        userId,
        grantedBy,
      });

      res.json({ message: 'Admin access granted' });
    } catch (error) {
      console.error('Error granting admin:', error);
      if (error instanceof z.ZodError) {
        return sendValidationError(res, 'Invalid admin grant request', error);
      }
      res.status(500).json({ message: 'Failed to grant admin access' });
    }
  });

  // App Configuration Routes (Admin Only)
  app.get('/api/admin/config', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const config = await db.select().from(appConfig);
      // Don't return actual values for sensitive keys like API keys
      const safeConfig = config.map((c) => ({
        key: c.key,
        // Mask the value if it looks like a key
        value: c.key.includes('key') || c.key.includes('secret') ? '********' : c.value,
        updatedAt: c.updatedAt,
      }));
      res.json(safeConfig);
    } catch (error) {
      console.error('Error fetching config:', error);
      res.status(500).json({ message: 'Failed to fetch configuration' });
    }
  });

  app.post('/api/admin/config', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { key, value } = appConfigUpdateSchema.parse(req.body);

      // Upsert configuration
      const [updated] = await db
        .insert(appConfig)
        .values({ key, value })
        .onConflictDoUpdate({
          target: appConfig.key,
          set: { value, updatedAt: new Date() },
        })
        .returning();

      res.json({ message: 'Configuration saved', key: updated.key });
    } catch (error) {
      console.error('Error saving config:', error);
      if (error instanceof z.ZodError) {
        return sendValidationError(res, 'Invalid configuration request', error);
      }
      res.status(500).json({ message: 'Failed to save configuration' });
    }
  });

  app.delete('/api/admin/revoke/:userId', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      await db.delete(adminRoles).where(eq(adminRoles.userId, userId));
      res.json({ message: 'Admin access revoked' });
    } catch (error) {
      console.error('Error revoking admin:', error);
      res.status(500).json({ message: 'Failed to revoke admin access' });
    }
  });

  app.get('/api/admin/check', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.json({ isAdmin: false });
      }
      const [admin] = await db
        .select()
        .from(adminRoles)
        .where(eq(adminRoles.userId, userId))
        .limit(1);

      res.json({ isAdmin: !!admin });
    } catch (error) {
      console.error('Error checking admin status:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Questions API
  app.get('/api/questions', async (req, res) => {
    try {
      const { category, categories, pillar, difficulty, excludeSeen, limit, shuffle } = req.query;

      const conditions = [];
      // Support comma-separated multi-category filter (?categories=Tech,Science) as well as
      // the legacy single-value ?category= param used by older callers.
      const categoryList: string[] = [];
      if (categories && typeof categories === 'string') {
        categoryList.push(
          ...categories
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        );
      } else if (category && category !== 'All') {
        categoryList.push(category as string);
      }
      if (categoryList.length === 1) {
        conditions.push(eq(questions.category, categoryList[0]));
      } else if (categoryList.length > 1) {
        conditions.push(inArray(questions.category, categoryList));
      }
      if (pillar) {
        conditions.push(eq(questions.pillar, pillar as string));
      }
      if (difficulty) {
        conditions.push(eq(questions.difficulty, difficulty as string));
      }

      // Always default to only approved questions for gameplay
      conditions.push(eq(questions.status, 'approved'));

      // Exclude seen questions for authenticated users
      const userId = getUserId(req);
      const shouldExcludeSeen = excludeSeen === 'true' && userId;

      let results;
      if (shouldExcludeSeen) {
        // Escalating cooldown cycle: 1 month → 3 months → 5 months, repeating
        const cooldownExpr = sql`
          CASE (${seenQuestions.seenCount} - 1) % 3
            WHEN 0 THEN INTERVAL '1 month'
            WHEN 1 THEN INTERVAL '3 months'
            WHEN 2 THEN INTERVAL '5 months'
          END
        `;

        // LEFT JOIN to find unseen or cooldown-expired questions
        const query = db
          .select({
            id: questions.id,
            category: questions.category,
            difficulty: questions.difficulty,
            question: questions.question,
            answer: questions.answer,
            acceptableAnswers: questions.acceptableAnswers,
            explanation: questions.explanation,
            pillar: questions.pillar,
            tags: questions.tags,
            sourceUrl: questions.sourceUrl,
            sourceName: questions.sourceName,
          })
          .from(questions)
          .leftJoin(
            seenQuestions,
            and(eq(questions.id, seenQuestions.questionId), eq(seenQuestions.userId, userId))
          )
          .where(
            and(
              ...conditions,
              sql`(${seenQuestions.questionId} IS NULL OR ${seenQuestions.seenAt} + ${cooldownExpr} <= NOW())`
            )
          );

        // Prefer never-seen questions first; only backfill with
        // cooldown-expired ones when unseen supply is exhausted.
        if (shuffle === 'true') {
          query.orderBy(
            sql`CASE WHEN ${seenQuestions.questionId} IS NULL THEN 0 ELSE 1 END`,
            sql`random()`
          );
        } else {
          query.orderBy(sql`CASE WHEN ${seenQuestions.questionId} IS NULL THEN 0 ELSE 1 END`);
        }
        if (limit) {
          query.limit(parseInt(limit as string, 10));
        }

        results = await query;
      } else {
        const query = db.select().from(questions);

        if (conditions.length > 0) {
          query.where(and(...conditions));
        }
        if (shuffle === 'true') {
          query.orderBy(sql`random()`);
        }
        if (limit) {
          query.limit(parseInt(limit as string, 10));
        }

        results = await query;
      }

      // Get distinct categories and pillars for UI (only from approved questions)
      const [allCategories, allPillars] = await Promise.all([
        db
          .selectDistinct({ category: questions.category })
          .from(questions)
          .where(eq(questions.status, 'approved')),
        db
          .selectDistinct({ pillar: questions.pillar })
          .from(questions)
          .where(eq(questions.status, 'approved')),
      ]);

      res.json({
        questions: results,
        total: results.length,
        categories: allCategories.map((c) => c.category).sort(),
        pillars: allPillars.map((p) => p.pillar).sort(),
      });
    } catch (error) {
      console.error('Error fetching questions:', error);
      res.status(500).json({ message: 'Failed to fetch questions' });
    }
  });

  // Mark questions as seen
  app.post('/api/questions/seen', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });

      const { questionIds } = seenQuestionsRequestSchema.parse(req.body);

      // Upsert with replay guard: only bump seen_count if the last
      // seen_at is more than 24 hours ago. This prevents duplicate
      // submissions or client retries from inflating the count and
      // pushing questions into longer cooldowns than warranted.
      await db
        .insert(seenQuestions)
        .values(questionIds.map((qId: string) => ({ userId, questionId: qId })))
        .onConflictDoUpdate({
          target: [seenQuestions.userId, seenQuestions.questionId],
          set: {
            seenCount: sql`CASE
              WHEN ${seenQuestions.seenAt} < NOW() - INTERVAL '24 hours'
              THEN ${seenQuestions.seenCount} + 1
              ELSE ${seenQuestions.seenCount}
            END`,
            seenAt: sql`CASE
              WHEN ${seenQuestions.seenAt} < NOW() - INTERVAL '24 hours'
              THEN NOW()
              ELSE ${seenQuestions.seenAt}
            END`,
          },
        });

      res.json({ message: 'Questions marked as seen', count: questionIds.length });
    } catch (error) {
      console.error('Error marking questions as seen:', error);
      if (error instanceof z.ZodError) {
        return sendValidationError(res, 'Invalid seen-question request', error);
      }
      res.status(500).json({ message: 'Failed to mark questions as seen' });
    }
  });

  // Create a new question (admin only)
  app.post('/api/questions', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const parsed = insertQuestionSchema.parse({
        ...req.body,
        id: req.body.id || crypto.randomUUID(),
      });

      const [newQuestion] = await db.insert(questions).values(parsed).returning();
      res.status(201).json(newQuestion);
    } catch (error) {
      console.error('Error creating question:', error);
      if (error instanceof z.ZodError) {
        return res.status(422).json({ message: 'Invalid question data', errors: error.errors });
      }
      res.status(500).json({ message: 'Failed to create question' });
    }
  });

  // Update a question (admin only)
  app.patch('/api/questions/:id', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const parsed = questionPatchSchema.parse(req.body);

      const [updated] = await db
        .update(questions)
        .set({ ...parsed, updatedAt: new Date() })
        .where(eq(questions.id, id))
        .returning();

      if (!updated) {
        return res.status(404).json({ message: 'Question not found' });
      }

      res.json(updated);
    } catch (error) {
      console.error('Error updating question:', error);
      if (error instanceof z.ZodError) {
        return sendValidationError(res, 'Invalid question update', error);
      }
      res.status(500).json({ message: 'Failed to update question' });
    }
  });

  // Admin question browser — all questions, all statuses
  app.get('/api/admin/questions', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const {
        status,
        category,
        pillar,
        search,
        limit: limitParam,
        offset: offsetParam,
      } = req.query;

      const conditions = [];
      if (status && status !== 'all') {
        conditions.push(eq(questions.status, status as string));
      }
      if (category && category !== 'all') {
        conditions.push(eq(questions.category, category as string));
      }
      if (pillar && pillar !== 'all') {
        conditions.push(eq(questions.pillar, pillar as string));
      }
      if (search && typeof search === 'string' && search.trim()) {
        const term = `%${search.trim()}%`;
        conditions.push(
          sql`(${questions.question} ilike ${term} or ${questions.answer} ilike ${term} or ${questions.category} ilike ${term})`
        );
      }

      const pageLimit = Math.min(parseInt(limitParam as string, 10) || 50, 200);
      const pageOffset = parseInt(offsetParam as string, 10) || 0;

      const rows = await db
        .select()
        .from(questions)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(sql`${questions.createdAt} desc`)
        .limit(pageLimit)
        .offset(pageOffset);

      const [totalResult, allCategories, allPillars] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(questions)
          .then((r) => r[0]?.count ?? 0),
        db.selectDistinct({ category: questions.category }).from(questions),
        db.selectDistinct({ pillar: questions.pillar }).from(questions),
      ]);

      res.json({
        questions: rows,
        total: totalResult,
        categories: allCategories.map((c) => c.category).sort(),
        pillars: allPillars.map((p) => p.pillar).sort(),
      });
    } catch (error) {
      console.error('Error fetching admin questions:', error);
      res.status(500).json({ message: 'Failed to fetch questions' });
    }
  });

  // Edit a single field on a question and record it in the changelog
  app.patch('/api/admin/questions/:id/field', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });

      const { field, value, aiSuggested } = parseQuestionFieldPatch(req.body);

      // Fetch the current row to capture the old value
      const [current] = await db.select().from(questions).where(eq(questions.id, id)).limit(1);
      if (!current) return res.status(404).json({ message: 'Question not found' });

      const oldValue =
        current[field as keyof typeof current] != null
          ? JSON.stringify(current[field as keyof typeof current])
          : null;

      // Apply the update
      const [updated] = await db
        .update(questions)
        .set({ [field]: value, updatedAt: new Date() } as Record<string, unknown>)
        .where(eq(questions.id, id))
        .returning();

      // Record in changelog
      await db.insert(questionEdits).values({
        id: crypto.randomUUID(),
        questionId: id,
        field,
        oldValue,
        newValue: value != null ? JSON.stringify(value) : null,
        changedBy: userId,
        aiSuggested: Boolean(aiSuggested),
      });

      res.json(updated);
    } catch (error) {
      console.error('Error patching question field:', error);
      if (error instanceof z.ZodError) {
        return sendValidationError(res, 'Invalid question field update', error);
      }
      res.status(500).json({ message: 'Failed to update field' });
    }
  });

  // AI fix suggestion for a specific field
  app.post(
    '/api/admin/questions/:id/ai-fix',
    isAuthenticated,
    isAdmin,
    aiLimiter,
    async (req, res) => {
      try {
        const { id } = req.params;
        const { field } = aiFixRequestSchema.parse(req.body);

        const [q] = await db.select().from(questions).where(eq(questions.id, id)).limit(1);
        if (!q) return res.status(404).json({ message: 'Question not found' });

        const suggestion = await getAiFieldFix(
          {
            id: q.id,
            category: q.category,
            difficulty: q.difficulty,
            question: q.question,
            answer: q.answer,
            explanation: q.explanation,
            pillar: q.pillar,
            tags: (q.tags as string[]) ?? [],
            sourceUrl: q.sourceUrl ?? null,
            sourceName: q.sourceName ?? null,
          },
          field as FixableField
        );

        res.json({ suggestion });
      } catch (error) {
        console.error('Error getting AI field fix:', error);
        if (error instanceof z.ZodError) {
          return sendValidationError(res, 'Invalid AI fix request', error);
        }
        res.status(500).json({ message: 'Failed to get AI suggestion' });
      }
    }
  );

  // Fetch the edit changelog for a question
  app.get('/api/admin/questions/:id/edits', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const edits = await db
        .select({
          id: questionEdits.id,
          questionId: questionEdits.questionId,
          field: questionEdits.field,
          oldValue: questionEdits.oldValue,
          newValue: questionEdits.newValue,
          aiSuggested: questionEdits.aiSuggested,
          changedAt: questionEdits.changedAt,
          changedBy: questionEdits.changedBy,
        })
        .from(questionEdits)
        .where(eq(questionEdits.questionId, id))
        .orderBy(sql`${questionEdits.changedAt} desc`)
        .limit(50);
      res.json(edits);
    } catch (error) {
      console.error('Error fetching question edits:', error);
      res.status(500).json({ message: 'Failed to fetch edit history' });
    }
  });

  // Delete a question (admin only). Cascades to seen_questions and
  // question_quality_sweep_dismissals via FK on delete cascade.
  app.delete('/api/questions/:id', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      // Clean up seen_questions rows that don't have ON DELETE CASCADE.
      await db.delete(seenQuestions).where(eq(seenQuestions.questionId, id));

      const deleted = await db.delete(questions).where(eq(questions.id, id)).returning();

      if (deleted.length === 0) {
        return res.status(404).json({ message: 'Question not found' });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting question:', error);
      res.status(500).json({ message: 'Failed to delete question' });
    }
  });

  // Staging API (Admin Only)
  app.get('/api/staging', isAuthenticated, isAdmin, async (req, res) => {
    try {
      // By default, fetch questions that are not 'approved'
      const pendingQuestions = await db
        .select()
        .from(questions)
        .where(sql`${questions.status} != 'approved'`)
        .orderBy(sql`${questions.createdAt} desc`);

      res.json(pendingQuestions);
    } catch (error) {
      console.error('Error fetching staging questions:', error);
      res.status(500).json({ message: 'Failed to fetch staging questions' });
    }
  });

  app.post('/api/staging/generate', isAuthenticated, isAdmin, aiLimiter, async (req, res) => {
    try {
      const parsed = stagingGenerateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(422).json({
          message: 'Invalid generation parameters',
          errors: parsed.error.errors,
        });
      }

      const { topic, count, pillar } = parsed.data;

      // Pull existing questions ONCE for both prompt seeding and post-filter.
      // Include 'approved' AND 'pending' so the same admin doesn't see dupes
      // of questions already sitting in their staging queue. Project to only
      // the columns downstream consumers read (selectTopicContext + novelty
      // filter) so we don't drag explanation, aiAnalysis, etc. across the wire.
      const existing = await db
        .select({
          id: questions.id,
          question: questions.question,
          answer: questions.answer,
          pillar: questions.pillar,
        })
        .from(questions)
        .where(sql`${questions.status} IN ('approved', 'pending')`);

      let allGenerated: Awaited<ReturnType<typeof generateQuestions>>;

      if (pillar === 'Mixed') {
        const batches = allocateMixed(count);
        console.info('[staging] Mixed generation', { topic, count, batches });
        const results = await Promise.all(
          batches.map(({ pillar: p, count: c }) => {
            const ctx = selectTopicContext({ topic, pillar: p, existing });
            return generateQuestions(topic, c, p, ctx);
          })
        );
        allGenerated = results.flat();
      } else {
        const ctx = selectTopicContext({ topic, pillar, existing });
        allGenerated = await generateQuestions(topic, count, pillar, ctx);
      }

      const { kept, dropped } = await filterNovelQuestions(allGenerated, existing);

      if (dropped.length > 0) {
        console.info('[staging] Novelty filter dropped duplicates', {
          topic,
          requested: count,
          generated: allGenerated.length,
          kept: kept.length,
          dropped: dropped.length,
          reasons: dropped.map((d) => ({
            id: d.question.id,
            reason: d.reason,
            matchType: d.matchType,
            similarityScore: d.similarityScore,
            matchedExistingId: d.matchedExistingId,
            matchedBatchId: d.matchedBatchId,
          })),
        });
      }

      const insertedQuestions =
        kept.length > 0
          ? await db
              .insert(questions)
              .values(
                kept.map((q) => ({
                  ...q,
                  aiAnalysis: q.aiAnalysis,
                }))
              )
              .returning()
          : [];

      res.status(201).json({
        message: 'Questions generated and added to staging successfully',
        count: insertedQuestions.length,
        droppedAsDuplicate: dropped.length,
        questions: insertedQuestions,
      });
    } catch (error) {
      console.error('Error generating questions:', error);
      res.status(500).json({ message: 'Failed to generate questions' });
    }
  });

  // Bulk-promote all pending staging questions to approved
  app.post('/api/staging/promote-all', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const promoted = await db
        .update(questions)
        .set({ status: 'approved', updatedAt: new Date() })
        .where(eq(questions.status, 'pending'))
        .returning({ id: questions.id });

      console.info('[staging] Bulk promoted all pending questions', { count: promoted.length });
      res.json({ count: promoted.length, ids: promoted.map((q) => q.id) });
    } catch (error) {
      console.error('Error bulk promoting questions:', error);
      res.status(500).json({ message: 'Failed to promote all questions' });
    }
  });

  app.post('/api/staging/:id/promote', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      const [promoted] = await db
        .update(questions)
        .set({
          status: 'approved',
          updatedAt: new Date(),
        })
        .where(eq(questions.id, id))
        .returning();

      if (!promoted) {
        return res.status(404).json({ message: 'Question not found' });
      }

      res.json(promoted);
    } catch (error) {
      console.error('Error promoting question:', error);
      res.status(500).json({ message: 'Failed to promote question' });
    }
  });

  app.post('/api/staging/:id/reject', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      const [rejected] = await db
        .update(questions)
        .set({
          status: 'rejected',
          updatedAt: new Date(),
        })
        .where(eq(questions.id, id))
        .returning();

      if (!rejected) {
        return res.status(404).json({ message: 'Question not found' });
      }

      res.json(rejected);
    } catch (error) {
      console.error('Error rejecting question:', error);
      res.status(500).json({ message: 'Failed to reject question' });
    }
  });

  // Quality Sweep (Admin Only)
  const sweepRequestSchema = z.object({
    skipFactCheck: z.boolean().optional().default(false),
    skipDuplicates: z.boolean().optional().default(false),
  });

  app.post('/api/admin/quality-sweep', isAuthenticated, isAdmin, aiLimiter, async (req, res) => {
    try {
      const parsed = sweepRequestSchema.parse(req.body);
      const { skipFactCheck, skipDuplicates } = parsed;

      // 1. Fetch all approved questions
      const allQuestions = await db
        .select()
        .from(questions)
        .where(eq(questions.status, 'approved'));

      if (allQuestions.length === 0) {
        return res.json({
          generatedAt: new Date().toISOString(),
          totalQuestions: 0,
          audit: {
            generatedAt: new Date().toISOString(),
            totalQuestions: 0,
            totalFindings: 0,
            flaggedQuestionCount: 0,
            findingsBySeverity: { high: 0, medium: 0, low: 0 },
            findingsByRule: {},
            findings: [],
          },
          duplicates: null,
          factCheck: null,
          recommendations: ['No approved questions found in the database.'],
        });
      }

      // 2. Static audit (instant)
      const auditRaw = auditQuestionQuality(allQuestions);

      // 2.5 Enrich subjective_prompt findings with AI-identified subjective phrase + rewrite
      await enrichSubjectiveFindings(auditRaw.findings, allQuestions);

      // 3. Duplicate detection (GPT-4o for conceptual pairs only)
      const duplicatesRaw = skipDuplicates ? null : await detectDuplicates(allQuestions);

      // 4. Fact-checking (GPT-4o per question)
      const factCheckRaw = skipFactCheck ? null : await batchFactCheck(allQuestions);

      // 4.5 Filter out previously-dismissed findings
      const dismissals = await db.select().from(questionQualitySweepDismissals);
      const dismissedStatic = new Set(
        dismissals
          .filter((d) => d.findingType === 'static')
          .map((d) => `${d.questionId}::${d.findingKey}`)
      );
      const dismissedDuplicates = new Set(
        dismissals.filter((d) => d.findingType === 'duplicate').map((d) => d.findingKey)
      );
      const dismissedFactCheck = new Set(
        dismissals.filter((d) => d.findingType === 'fact_check').map((d) => d.questionId)
      );

      const filteredFindings = auditRaw.findings.filter(
        (f) => !isStaticFindingDismissed(dismissedStatic, f)
      );
      const recountedSeverity: Record<'high' | 'medium' | 'low', number> = {
        high: 0,
        medium: 0,
        low: 0,
      };
      const recountedRule: Record<string, number> = {};
      for (const ruleKey of Object.keys(auditRaw.findingsByRule)) {
        recountedRule[ruleKey] = 0;
      }
      for (const f of filteredFindings) {
        recountedSeverity[f.severity]++;
        recountedRule[f.rule] = (recountedRule[f.rule] ?? 0) + 1;
      }
      const audit = {
        ...auditRaw,
        findings: filteredFindings,
        totalFindings: filteredFindings.length,
        flaggedQuestionCount: new Set(filteredFindings.map((f) => f.questionId)).size,
        findingsBySeverity: recountedSeverity,
        findingsByRule: recountedRule as typeof auditRaw.findingsByRule,
      };

      const duplicates = duplicatesRaw
        ? (() => {
            const filtered = duplicatesRaw.duplicatesFound.filter(
              (m) => !dismissedDuplicates.has(duplicatePairKey(m.questionIdA, m.questionIdB))
            );
            const byType: Record<'exact' | 'near_duplicate' | 'conceptual', number> = {
              exact: 0,
              near_duplicate: 0,
              conceptual: 0,
            };
            for (const m of filtered) byType[m.matchType]++;
            return {
              ...duplicatesRaw,
              duplicatesFound: filtered,
              duplicatesByType: byType,
            };
          })()
        : null;

      const factCheck = factCheckRaw
        ? {
            ...factCheckRaw,
            results: factCheckRaw.results.filter((r) => !dismissedFactCheck.has(r.questionId)),
          }
        : null;

      // 5. Compute recommendations
      const recommendations: string[] = [];
      if (audit.findingsBySeverity.high > 0) {
        recommendations.push(
          `${audit.findingsBySeverity.high} high-severity audit finding(s) — fix before next release.`
        );
      }
      if (audit.findingsBySeverity.medium > 0) {
        recommendations.push(
          `${audit.findingsBySeverity.medium} medium-severity audit finding(s) — review and improve.`
        );
      }
      if (duplicates && duplicates.duplicatesFound.length > 0) {
        recommendations.push(
          `${duplicates.duplicatesFound.length} duplicate pair(s) found — remove or merge the lower-quality version of each pair.`
        );
      }
      if (factCheck) {
        const failures = factCheck.results.filter((r) => r.verdict === 'fail').length;
        const flags = factCheck.results.filter((r) => r.verdict === 'flag').length;
        if (failures > 0) {
          recommendations.push(`${failures} question(s) failed fact-check — review immediately.`);
        }
        if (flags > 0) {
          recommendations.push(
            `${flags} question(s) flagged by fact-check — verify before next release.`
          );
        }
      }
      if (recommendations.length === 0) {
        recommendations.push('No critical issues found. All approved questions passed the sweep.');
      }

      // Build a snapshot map for all flagged questions so the frontend can
      // show question text, hidden answer, and current state without extra fetches.
      const flaggedIds = new Set<string>([
        ...audit.findings.map((f) => f.questionId),
        ...(factCheck?.results.map((r) => r.questionId) ?? []),
        ...(duplicates?.duplicatesFound.flatMap((m) => [m.questionIdA, m.questionIdB]) ?? []),
      ]);

      const questionsById: Record<string, QuestionSnapshot> = {};
      for (const q of allQuestions) {
        if (flaggedIds.has(q.id)) {
          questionsById[q.id] = {
            question: q.question,
            answer: q.answer,
            tags: (q.tags as string[]) ?? [],
            category: q.category,
            pillar: q.pillar,
            hasSource: !!(q.sourceUrl && q.sourceName),
            difficulty: q.difficulty,
            // Only expose sourceDomain when full metadata is present (both URL
            // and name). This keeps hasSource and sourceDomain consistent so the
            // UI never shows "Source: ..." and "no source" simultaneously.
            sourceDomain:
              q.sourceUrl && q.sourceName ? extractSourceDomain(q.sourceUrl, q.sourceName) : null,
          };
        }
      }

      res.json({
        generatedAt: new Date().toISOString(),
        totalQuestions: allQuestions.length,
        audit,
        duplicates,
        factCheck,
        recommendations,
        questionsById,
      });
    } catch (error) {
      console.error('Error running quality sweep:', error);
      if (error instanceof z.ZodError) {
        return sendValidationError(res, 'Invalid quality sweep request', error);
      }
      res.status(500).json({ message: 'Quality sweep failed' });
    }
  });

  // Validate selected questions through the Quality Sweep pipeline (Admin Only).
  // Runs the same static audit + optional fact-check pipeline as the full sweep
  // but scoped to specific question IDs instead of the entire approved corpus.
  const validateRequestSchema = z.object({
    questionIds: z.array(z.string().min(1)).min(1).max(50),
    skipFactCheck: z.boolean().optional().default(false),
  });

  app.post(
    '/api/admin/quality-sweep/validate',
    isAuthenticated,
    isAdmin,
    aiLimiter,
    async (req, res) => {
      try {
        const parsed = validateRequestSchema.parse(req.body);
        const { questionIds, skipFactCheck } = parsed;

        // 1. Fetch the requested questions
        const selectedQuestions = await db
          .select()
          .from(questions)
          .where(and(inArray(questions.id, questionIds), ne(questions.status, 'rejected')));

        if (selectedQuestions.length === 0) {
          return res.status(404).json({
            message: 'No questions found for the provided IDs.',
            questionIds,
          });
        }

        // 2. Static audit
        const auditRaw = auditQuestionQuality(selectedQuestions);

        // 2.5 Enrich subjective_prompt findings with AI phrase + rewrite
        await enrichSubjectiveFindings(auditRaw.findings, selectedQuestions);

        // 3. Fact-checking (GPT-4o per question, skippable)
        const factCheckRaw = skipFactCheck ? null : await batchFactCheck(selectedQuestions);

        // 4. Filter out previously-dismissed findings for these questions
        const dismissals = await db
          .select()
          .from(questionQualitySweepDismissals)
          .where(inArray(questionQualitySweepDismissals.questionId, questionIds));

        const dismissedStatic = new Set(
          dismissals
            .filter((d) => d.findingType === 'static')
            .map((d) => `${d.questionId}::${d.findingKey}`)
        );
        const dismissedFactCheck = new Set(
          dismissals.filter((d) => d.findingType === 'fact_check').map((d) => d.questionId)
        );

        const filteredFindings = auditRaw.findings.filter(
          (f) => !isStaticFindingDismissed(dismissedStatic, f)
        );
        const recountedSeverity: Record<'high' | 'medium' | 'low', number> = {
          high: 0,
          medium: 0,
          low: 0,
        };
        const recountedRule: Record<string, number> = {};
        for (const ruleKey of Object.keys(auditRaw.findingsByRule)) {
          recountedRule[ruleKey] = 0;
        }
        for (const f of filteredFindings) {
          recountedSeverity[f.severity]++;
          recountedRule[f.rule] = (recountedRule[f.rule] ?? 0) + 1;
        }
        const audit = {
          ...auditRaw,
          findings: filteredFindings,
          totalFindings: filteredFindings.length,
          flaggedQuestionCount: new Set(filteredFindings.map((f) => f.questionId)).size,
          findingsBySeverity: recountedSeverity,
          findingsByRule: recountedRule as typeof auditRaw.findingsByRule,
        };

        const factCheck = factCheckRaw
          ? {
              ...factCheckRaw,
              results: factCheckRaw.results.filter((r) => !dismissedFactCheck.has(r.questionId)),
            }
          : null;

        // 5. Build snapshot map for all selected questions
        const questionsById: Record<string, QuestionSnapshot> = {};
        for (const q of selectedQuestions) {
          questionsById[q.id] = {
            question: q.question,
            answer: q.answer,
            tags: (q.tags as string[]) ?? [],
            category: q.category,
            pillar: q.pillar,
            hasSource: !!(q.sourceUrl && q.sourceName),
            difficulty: q.difficulty,
            sourceDomain:
              q.sourceUrl && q.sourceName ? extractSourceDomain(q.sourceUrl, q.sourceName) : null,
          };
        }

        res.json({
          generatedAt: new Date().toISOString(),
          totalRequested: questionIds.length,
          totalFound: selectedQuestions.length,
          audit,
          factCheck,
          questionsById,
        });
      } catch (error) {
        console.error('Error validating selected questions:', error);
        if (error instanceof z.ZodError) {
          return sendValidationError(res, 'Invalid validate request', error);
        }
        res.status(500).json({ message: 'Question validation failed' });
      }
    }
  );

  // Dismiss a quality-sweep finding so it stops appearing in future sweeps.
  const dismissRequestSchema = z.object({
    questionId: z.string().min(1),
    findingType: z.enum(['static', 'duplicate', 'fact_check']),
    findingKey: z.string().min(1),
    reason: z.string().optional(),
  });

  app.post('/api/admin/quality-sweep/dismiss', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const parsed = dismissRequestSchema.parse(req.body);
      const userId = getUserId(req);

      // Idempotent: on conflict (unique index), return the existing row.
      const [row] = await db
        .insert(questionQualitySweepDismissals)
        .values({
          questionId: parsed.questionId,
          findingType: parsed.findingType,
          findingKey: parsed.findingKey,
          reason: parsed.reason,
          dismissedBy: userId,
        })
        .onConflictDoNothing()
        .returning();

      if (row) {
        return res.json({ id: row.id });
      }

      // Conflict — fetch the existing row to return its id.
      const [existing] = await db
        .select()
        .from(questionQualitySweepDismissals)
        .where(
          and(
            eq(questionQualitySweepDismissals.questionId, parsed.questionId),
            eq(questionQualitySweepDismissals.findingType, parsed.findingType),
            eq(questionQualitySweepDismissals.findingKey, parsed.findingKey)
          )
        )
        .limit(1);

      res.json({ id: existing?.id ?? '' });
    } catch (error) {
      console.error('Error dismissing finding:', error);
      if (error instanceof z.ZodError) {
        return res.status(422).json({ message: 'Invalid dismiss request', errors: error.errors });
      }
      res.status(500).json({ message: 'Failed to dismiss finding' });
    }
  });

  return httpServer;
}
