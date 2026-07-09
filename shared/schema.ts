import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';

import { DISPUTE_VOTE_OUTCOMES, disputeIdSchema, roomNicknameSchema } from './models/rooms';

// Export auth models (REQUIRED for Replit Auth)
export * from './models/auth';

// Export chat models (for AI integrations)
export * from './models/chat';

// Export question models (questions DB + seen-question tracking)
export * from './models/questions';

// Export quality sweep API types
export * from './models/quality-sweep';

// Export quality sweep dismissals (DB table)
export * from './models/quality-sweep-dismissals';

// Export multiplayer rooms tables and API contract
export * from './models/rooms';

// Disputes table for QA logging
export const disputeOutcomeSchema = z.enum(DISPUTE_VOTE_OUTCOMES);
export const disputeOutcomeEnum = pgEnum('dispute_outcome', DISPUTE_VOTE_OUTCOMES);
export const disputeVoterSnapshotSchema = z
  .object({
    playerId: z.string().uuid(),
    displayName: roomNicknameSchema,
  })
  .strict();

export type DisputeVoterSnapshot = z.infer<typeof disputeVoterSnapshotSchema>;

export const disputes = pgTable('disputes', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  questionId: varchar('question_id').notNull(),
  questionText: text('question_text').notNull(),
  correctAnswer: text('correct_answer').notNull(),
  teamName: text('team_name').notNull(),
  submittedAnswer: text('submitted_answer'),
  teamExplanation: text('team_explanation').notNull(),
  timestamp: timestamp('timestamp').notNull().defaultNow(),
  status: varchar('status', { length: 20 }).notNull().default('pending'), // pending, resolved, rejected
  resolutionNote: text('resolution_note'),
  aiAnalysis: jsonb('ai_analysis'),
  roomId: uuid('room_id'),
  roomCode: varchar('room_code', { length: 5 }),
  attemptKey: varchar('attempt_key', { length: 255 }),
  disputingPlayerId: uuid('disputing_player_id'),
  disputingPlayerName: varchar('disputing_player_name', { length: 20 }),
  votingEnabled: boolean('voting_enabled').notNull().default(false),
  eligibleVoterSnapshot: jsonb('eligible_voter_snapshot').$type<DisputeVoterSnapshot[]>(),
  threshold: integer('threshold'),
  outcome: disputeOutcomeEnum('outcome'),
  originalPointsDelta: integer('original_points_delta'),
  finalPointsDelta: integer('final_points_delta'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
});

export const insertDisputeSchema = createInsertSchema(disputes, {
  id: disputeIdSchema.optional(),
  outcome: disputeOutcomeSchema.nullable().optional(),
  eligibleVoterSnapshot: z.array(disputeVoterSnapshotSchema).max(4).nullable().optional(),
})
  .omit({
    id: true,
    timestamp: true,
    status: true,
    resolutionNote: true,
    aiAnalysis: true,
  })
  .extend({
    roomId: z.string().uuid().nullable().optional(),
    roomCode: z
      .string()
      .regex(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/)
      .nullable()
      .optional(),
    attemptKey: z.string().trim().min(1).max(255).nullable().optional(),
    disputingPlayerId: z.string().uuid().nullable().optional(),
    disputingPlayerName: roomNicknameSchema.nullable().optional(),
    threshold: z.number().int().positive().nullable().optional(),
    originalPointsDelta: z.number().int().nullable().optional(),
    finalPointsDelta: z.number().int().nullable().optional(),
    decidedAt: z.date().nullable().optional(),
  });

export type InsertDispute = z.infer<typeof insertDisputeSchema>;
export type Dispute = typeof disputes.$inferSelect;

export const disputeBallots = pgTable(
  'dispute_ballots',
  {
    id: varchar('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    disputeId: varchar('dispute_id', { length: 255 }).notNull(),
    voterPlayerId: uuid('voter_player_id').notNull(),
    voterPlayerName: varchar('voter_player_name', { length: 20 }).notNull(),
    approve: boolean('approve').notNull(),
    castAt: timestamp('cast_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_dispute_ballots_dispute').on(table.disputeId),
    uniqueIndex('uq_dispute_ballots_dispute_voter').on(table.disputeId, table.voterPlayerId),
  ]
);

export const insertDisputeBallotSchema = createInsertSchema(disputeBallots, {
  disputeId: disputeIdSchema,
  voterPlayerId: z.string().uuid(),
  voterPlayerName: roomNicknameSchema,
})
  .omit({ id: true, castAt: true })
  .strict();

export type InsertDisputeBallot = z.infer<typeof insertDisputeBallotSchema>;
export type DisputeBallot = typeof disputeBallots.$inferSelect;

// App configuration for LLM settings (stored securely)
export const appConfig = pgTable('app_config', {
  key: varchar('key').primaryKey().notNull(), // e.g., 'openai_api_key', 'llm_provider'
  value: text('value').notNull(), // Encrypted or raw value
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export type AppConfig = typeof appConfig.$inferSelect;

// Admin roles table
export const adminRoles = pgTable('admin_roles', {
  userId: varchar('user_id').primaryKey().notNull(),
  grantedAt: timestamp('granted_at').notNull().defaultNow(),
  grantedBy: varchar('granted_by'),
});

export type AdminRole = typeof adminRoles.$inferSelect;

export interface AIAnalysis {
  verdict: 'CORRECT' | 'INCORRECT' | 'AMBIGUOUS';
  confidence: number;
  reasoning: string;
  suggestedFix?: {
    question?: string;
    answer?: string;
    explanation?: string;
  };
  sources: string[];
}
