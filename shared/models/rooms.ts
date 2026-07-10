import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { VALID_CATEGORIES } from '../constants/categories';

export const ROOM_STATUSES = ['lobby', 'active', 'finished', 'abandoned'] as const;
export const ROOM_PHASES = [
  'LOBBY',
  'QUESTION',
  'REVEAL',
  'DISPUTE_VOTE',
  'ROUND_SCORE',
  'GAME_OVER',
] as const;
export const ROOM_VERDICTS = ['CORRECT', 'INCORRECT', 'PASS'] as const;
export const ROOM_PRESENCES = ['online', 'away', 'stale'] as const;
export const ROOM_ROUND_OPTIONS = [5, 10, 15, 20] as const;
export const DISPUTE_VOTE_STATUSES = ['OPEN', 'FINALIZED'] as const;
export const DISPUTE_VOTE_OUTCOMES = [
  'approved',
  'rejected',
  'tied',
  'expired',
  'canceled',
] as const;
export const ROOM_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
export const MAX_PLAYERS = 4;
export const MAX_DISPUTE_EXPLANATION_LENGTH = 2000;

export const roomStatusEnum = pgEnum('room_status', ROOM_STATUSES);
export const roomPhaseEnum = pgEnum('room_phase', ROOM_PHASES);

export const roomNicknameSchema = z.string().trim().min(1).max(20);
export const disputeIdSchema = z.string().trim().min(1).max(255);
export const disputeExplanationSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_DISPUTE_EXPLANATION_LENGTH);

const voterIdsSchema = z
  .array(z.string().uuid())
  .max(MAX_PLAYERS)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'voter IDs must be unique',
  });

const disputeVoteSnapshotBaseSchema = z.object({
  disputeId: disputeIdSchema,
  disputingPlayerId: z.string().uuid(),
  disputingPlayerName: roomNicknameSchema,
  explanation: disputeExplanationSchema,
  eligibleVoterIds: voterIdsSchema,
  submittedVoterIds: voterIdsSchema,
  threshold: z.number().int().positive(),
  openedAt: z.string().datetime(),
  closesAt: z.string().datetime(),
});

export const openDisputeVoteSnapshotSchema = disputeVoteSnapshotBaseSchema
  .extend({ status: z.literal('OPEN') })
  .strict()
  .superRefine((snapshot, context) => {
    const eligibleVoterIds = new Set(snapshot.eligibleVoterIds);
    const submittedOutsideEligibility = snapshot.submittedVoterIds.some(
      (playerId) => !eligibleVoterIds.has(playerId)
    );

    if (submittedOutsideEligibility) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['submittedVoterIds'],
        message: 'submitted voters must be eligible voters',
      });
    }

    if (snapshot.eligibleVoterIds.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['eligibleVoterIds'],
        message: 'an open vote requires at least one eligible voter',
      });
    }

    const expectedThreshold = Math.floor(snapshot.eligibleVoterIds.length / 2) + 1;
    if (snapshot.threshold !== expectedThreshold) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['threshold'],
        message: 'threshold must be a strict majority of eligible voters',
      });
    }
  });

export const finalizedDisputeVoteSnapshotSchema = disputeVoteSnapshotBaseSchema
  .extend({
    status: z.literal('FINALIZED'),
    yesCount: z.number().int().nonnegative(),
    noCount: z.number().int().nonnegative(),
    nonResponseCount: z.number().int().nonnegative(),
    outcome: z.enum(DISPUTE_VOTE_OUTCOMES),
    originalPointsDelta: z.number().int(),
    finalPointsDelta: z.number().int(),
    decidedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const eligibleCount = snapshot.eligibleVoterIds.length;
    const expectedThreshold = Math.floor(eligibleCount / 2) + 1;

    if (snapshot.threshold !== expectedThreshold) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['threshold'],
        message: 'threshold must be a strict majority of eligible voters',
      });
    }

    if (snapshot.yesCount + snapshot.noCount + snapshot.nonResponseCount !== eligibleCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nonResponseCount'],
        message: 'vote counts must account for every eligible voter',
      });
    }
  });

export const roomDisputeVoteSnapshotSchema = z.union([
  openDisputeVoteSnapshotSchema,
  finalizedDisputeVoteSnapshotSchema,
]);

export type OpenDisputeVoteSnapshot = z.infer<typeof openDisputeVoteSnapshotSchema>;
export type FinalizedDisputeVoteSnapshot = z.infer<typeof finalizedDisputeVoteSnapshotSchema>;
export type RoomDisputeVoteSnapshot = z.infer<typeof roomDisputeVoteSnapshotSchema>;

export const roomAttemptSchema = z.object({
  questionId: z.string().min(1),
  playerId: z.string().uuid(),
  submittedAnswer: z.string().nullable(),
  verdict: z.enum(ROOM_VERDICTS),
  pointsDelta: z.number().int(),
});

export type RoomAttempt = z.infer<typeof roomAttemptSchema>;

export const rooms = pgTable('rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 5 }).notNull().unique(),
  status: roomStatusEnum('status').notNull().default('lobby'),
  phase: roomPhaseEnum('phase').notNull().default('LOBBY'),
  version: integer('version').notNull().default(1),
  // These remain nullable while the room and host player are created atomically.
  hostPlayerId: uuid('host_player_id').references((): AnyPgColumn => roomPlayers.id, {
    onDelete: 'set null',
  }),
  // Stores comma-separated categories or 'All' (extended to 255 by migration 0004)
  category: varchar('category', { length: 255 }).notNull(),
  numRounds: integer('num_rounds').notNull(),
  questionIds: jsonb('question_ids').$type<string[]>().notNull().default([]),
  currentQuestionIndex: integer('current_question_index').notNull().default(0),
  activePlayerId: uuid('active_player_id').references((): AnyPgColumn => roomPlayers.id, {
    onDelete: 'set null',
  }),
  currentAttempt: jsonb('current_attempt').$type<RoomAttempt>(),
  opponentDisputeVotingEnabled: boolean('opponent_dispute_voting_enabled').notNull().default(false),
  activeDisputeId: varchar('active_dispute_id', { length: 255 }),
  currentDisputeVote: jsonb('current_dispute_vote').$type<RoomDisputeVoteSnapshot | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  expiresAt: timestamp('expires_at', { withTimezone: true })
    .notNull()
    .default(sql`now() + interval '24 hours'`),
});

export const roomPlayers = pgTable(
  'room_players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    nickname: varchar('nickname', { length: 20 }).notNull(),
    token: varchar('token', { length: 128 }).notNull().unique(),
    joinOrder: integer('join_order').notNull(),
    score: integer('score').notNull().default(0),
    questionCount: integer('question_count').notNull().default(0),
    lastRoundDelta: integer('last_round_delta').notNull().default(0),
    isHost: boolean('is_host').notNull().default(false),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_room_players_room').on(table.roomId),
    uniqueIndex('uq_room_players_room_nickname_ci').on(table.roomId, sql`lower(${table.nickname})`),
    uniqueIndex('uq_room_players_room_join_order').on(table.roomId, table.joinOrder),
  ]
);

export const roomStatusSchema = z.enum(ROOM_STATUSES);
export const roomPhaseSchema = z.enum(ROOM_PHASES);
export const roomVerdictSchema = z.enum(ROOM_VERDICTS);
export const roomPresenceSchema = z.enum(ROOM_PRESENCES);
export const roomCodeSchema = z.string().regex(ROOM_CODE_PATTERN);
export const roomCategorySchema = z.enum(['All', ...VALID_CATEGORIES]);
// Multi-select: ['All'] means no filter; otherwise a non-empty list of specific categories
export const roomCategoriesSchema = z.array(roomCategorySchema).min(1);
export const roomRoundsSchema = z.union([
  z.literal(ROOM_ROUND_OPTIONS[0]),
  z.literal(ROOM_ROUND_OPTIONS[1]),
  z.literal(ROOM_ROUND_OPTIONS[2]),
  z.literal(ROOM_ROUND_OPTIONS[3]),
]);

export type RoomStatus = z.infer<typeof roomStatusSchema>;
export type RoomPhase = z.infer<typeof roomPhaseSchema>;
export type RoomVerdict = z.infer<typeof roomVerdictSchema>;
export type RoomPresence = z.infer<typeof roomPresenceSchema>;
export type RoomCategory = z.infer<typeof roomCategorySchema>;
export type RoomCategories = z.infer<typeof roomCategoriesSchema>;
export type RoomRounds = z.infer<typeof roomRoundsSchema>;

export const insertRoomSchema = createInsertSchema(rooms, {
  code: roomCodeSchema,
  status: roomStatusSchema.default('lobby'),
  phase: roomPhaseSchema.default('LOBBY'),
  category: roomCategorySchema,
  numRounds: roomRoundsSchema,
  questionIds: z.array(z.string()).default([]),
  currentAttempt: roomAttemptSchema.nullable().optional(),
  opponentDisputeVotingEnabled: z.boolean().default(false),
  activeDisputeId: disputeIdSchema.nullable().optional(),
  currentDisputeVote: roomDisputeVoteSnapshotSchema.nullable().optional(),
}).omit({ createdAt: true, updatedAt: true, expiresAt: true });

export const selectRoomSchema = createSelectSchema(rooms, {
  status: roomStatusSchema,
  phase: roomPhaseSchema,
  currentAttempt: roomAttemptSchema.nullable(),
  currentDisputeVote: roomDisputeVoteSnapshotSchema.nullable(),
});

export const insertRoomPlayerSchema = createInsertSchema(roomPlayers, {
  nickname: roomNicknameSchema,
}).omit({ lastSeenAt: true, leftAt: true });

export const selectRoomPlayerSchema = createSelectSchema(roomPlayers);

export type Room = typeof rooms.$inferSelect;
export type InsertRoom = z.infer<typeof insertRoomSchema>;
export type RoomPlayer = typeof roomPlayers.$inferSelect;
export type InsertRoomPlayer = z.infer<typeof insertRoomPlayerSchema>;

export const roomPlayerSnapshotSchema = z.object({
  id: z.string().uuid(),
  nickname: roomNicknameSchema,
  joinOrder: z.number().int().nonnegative(),
  score: z.number().int(),
  questionCount: z.number().int().nonnegative(),
  lastRoundDelta: z.number().int(),
  isHost: z.boolean(),
  presence: roomPresenceSchema,
  lastSeenAt: z.string().datetime(),
  leftAt: z.string().datetime().nullable(),
});

export const redactedRoomQuestionSchema = z
  .object({
    id: z.string().min(1),
    category: z.enum(VALID_CATEGORIES),
    difficulty: z.enum(['Easy', 'Medium', 'Hard']),
    question: z.string().min(1),
    pillar: z.string().min(1),
    tags: z.array(z.string()),
    sourceUrl: z.string().url().nullable(),
    sourceName: z.string().nullable(),
  })
  .strict();

export const revealedRoomQuestionSchema = redactedRoomQuestionSchema.extend({
  answer: z.string().min(1),
  acceptableAnswers: z.array(z.string()),
  explanation: z.string().min(1),
});

export const roomQuestionSnapshotSchema = z.union([
  redactedRoomQuestionSchema,
  revealedRoomQuestionSchema,
]);

const roomSnapshotBaseSchema = z.object({
  id: z.string().uuid(),
  code: roomCodeSchema,
  status: roomStatusSchema,
  version: z.number().int().positive(),
  hostPlayerId: z.string().uuid().nullable(),
  categories: roomCategoriesSchema,
  numRounds: roomRoundsSchema,
  currentQuestionIndex: z.number().int().nonnegative(),
  activePlayerId: z.string().uuid().nullable(),
  currentAttempt: roomAttemptSchema.nullable(),
  opponentDisputeVotingEnabled: z.boolean().default(false),
  currentDisputeVote: roomDisputeVoteSnapshotSchema.nullable().default(null),
  players: z.array(roomPlayerSnapshotSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const roomSnapshotSchema = z.discriminatedUnion('phase', [
  roomSnapshotBaseSchema.extend({
    phase: z.literal('LOBBY'),
    currentQuestion: redactedRoomQuestionSchema.nullable(),
    currentDisputeVote: z.null().default(null),
  }),
  roomSnapshotBaseSchema.extend({
    phase: z.literal('QUESTION'),
    currentQuestion: redactedRoomQuestionSchema,
    currentDisputeVote: z.null().default(null),
  }),
  roomSnapshotBaseSchema.extend({
    phase: z.literal('REVEAL'),
    currentQuestion: revealedRoomQuestionSchema,
    currentDisputeVote: finalizedDisputeVoteSnapshotSchema.nullable().default(null),
  }),
  roomSnapshotBaseSchema.extend({
    phase: z.literal('DISPUTE_VOTE'),
    currentQuestion: revealedRoomQuestionSchema,
    currentDisputeVote: openDisputeVoteSnapshotSchema,
  }),
  roomSnapshotBaseSchema.extend({
    phase: z.literal('ROUND_SCORE'),
    currentQuestion: revealedRoomQuestionSchema,
    currentDisputeVote: z.null().default(null),
  }),
  roomSnapshotBaseSchema.extend({
    phase: z.literal('GAME_OVER'),
    currentQuestion: revealedRoomQuestionSchema,
    currentDisputeVote: z.null().default(null),
  }),
]);

export type RoomPlayerSnapshot = z.infer<typeof roomPlayerSnapshotSchema>;
export type RedactedRoomQuestion = z.infer<typeof redactedRoomQuestionSchema>;
export type RevealedRoomQuestion = z.infer<typeof revealedRoomQuestionSchema>;
export type RoomQuestionSnapshot = z.infer<typeof roomQuestionSnapshotSchema>;
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;

export const roomCodeParamsSchema = z.object({ code: roomCodeSchema });
export const createRoomRequestSchema = z.object({
  nickname: roomNicknameSchema,
  categories: roomCategoriesSchema,
  numRounds: roomRoundsSchema,
  opponentDisputeVotingEnabled: z.boolean().default(false),
});
export const joinRoomRequestSchema = z.object({ nickname: roomNicknameSchema });
export const excludeQuestionIdsSchema = z
  .array(z.string().trim().min(1))
  .max(500)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'excludeQuestionIds must not contain duplicates',
  });

export const startRoomRequestSchema = z
  .object({
    excludeQuestionIds: excludeQuestionIdsSchema.optional(),
  })
  .strict();
export const answerRoomRequestSchema = z.object({ answer: z.string().trim().min(1).nullable() });
export const advanceRoomRequestSchema = z.object({}).strict();
export const continueRoomRequestSchema = z.object({}).strict();
export const skipRoomRequestSchema = z.object({}).strict();
export const endRoomRequestSchema = z.object({}).strict();
export const leaveRoomRequestSchema = z.object({}).strict();
export const pollRoomRequestSchema = z.object({
  sinceVersion: z.coerce.number().int().nonnegative().optional(),
});

export const createRoomResponseSchema = z.object({
  code: roomCodeSchema,
  playerId: z.string().uuid(),
  token: z.string().min(1),
});
export const joinRoomResponseSchema = z.object({
  playerId: z.string().uuid(),
  token: z.string().min(1),
  snapshot: roomSnapshotSchema,
});
export const roomActionResponseSchema = z.object({ snapshot: roomSnapshotSchema });
export const submitMultiplayerDisputeRequestSchema = z
  .object({ explanation: disputeExplanationSchema })
  .strict();
export const castDisputeVoteRequestSchema = z.object({ approve: z.boolean() }).strict();
export const cancelDisputeVoteRequestSchema = z.object({}).strict();
export const submitMultiplayerDisputeResponseSchema = roomActionResponseSchema;
export const castDisputeVoteResponseSchema = roomActionResponseSchema;
export const cancelDisputeVoteResponseSchema = roomActionResponseSchema;
export const unchangedRoomPollResponseSchema = z.object({ changed: z.literal(false) });
export const pollRoomResponseSchema = z.union([
  unchangedRoomPollResponseSchema,
  roomSnapshotSchema,
]);
export const roomErrorResponseSchema = z.object({ message: z.string().min(1) });

export const startRoomResponseSchema = roomActionResponseSchema;
export const answerRoomResponseSchema = roomActionResponseSchema;
export const advanceRoomResponseSchema = roomActionResponseSchema;
export const continueRoomResponseSchema = roomActionResponseSchema;
export const skipRoomResponseSchema = roomActionResponseSchema;
export const endRoomResponseSchema = roomActionResponseSchema;
export const leaveRoomResponseSchema = z.object({
  ok: z.literal(true),
  snapshot: roomSnapshotSchema,
});

export type RoomCodeParams = z.infer<typeof roomCodeParamsSchema>;
export type CreateRoomRequest = z.input<typeof createRoomRequestSchema>;
export type SubmitMultiplayerDisputeRequest = z.infer<typeof submitMultiplayerDisputeRequestSchema>;
export type CastDisputeVoteRequest = z.infer<typeof castDisputeVoteRequestSchema>;
export type CancelDisputeVoteRequest = z.infer<typeof cancelDisputeVoteRequestSchema>;
export type JoinRoomRequest = z.infer<typeof joinRoomRequestSchema>;
export type StartRoomRequest = z.infer<typeof startRoomRequestSchema>;
export type AnswerRoomRequest = z.infer<typeof answerRoomRequestSchema>;
export type AdvanceRoomRequest = z.infer<typeof advanceRoomRequestSchema>;
export type ContinueRoomRequest = z.infer<typeof continueRoomRequestSchema>;
export type SkipRoomRequest = z.infer<typeof skipRoomRequestSchema>;
export type EndRoomRequest = z.infer<typeof endRoomRequestSchema>;
export type LeaveRoomRequest = z.infer<typeof leaveRoomRequestSchema>;
export type PollRoomRequest = z.infer<typeof pollRoomRequestSchema>;
export type CreateRoomResponse = z.infer<typeof createRoomResponseSchema>;
export type JoinRoomResponse = z.infer<typeof joinRoomResponseSchema>;
export type RoomActionResponse = z.infer<typeof roomActionResponseSchema>;
export type SubmitMultiplayerDisputeResponse = z.infer<
  typeof submitMultiplayerDisputeResponseSchema
>;
export type CastDisputeVoteResponse = z.infer<typeof castDisputeVoteResponseSchema>;
export type CancelDisputeVoteResponse = z.infer<typeof cancelDisputeVoteResponseSchema>;
export type StartRoomResponse = RoomActionResponse;
export type AnswerRoomResponse = RoomActionResponse;
export type AdvanceRoomResponse = RoomActionResponse;
export type ContinueRoomResponse = RoomActionResponse;
export type SkipRoomResponse = RoomActionResponse;
export type EndRoomResponse = RoomActionResponse;
export type LeaveRoomResponse = z.infer<typeof leaveRoomResponseSchema>;
export type RoomPollResponse = z.infer<typeof pollRoomResponseSchema>;
export type UnchangedRoomPollResponse = z.infer<typeof unchangedRoomPollResponseSchema>;
export type RoomErrorResponse = z.infer<typeof roomErrorResponseSchema>;
