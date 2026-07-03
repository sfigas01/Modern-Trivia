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
export const ROOM_PHASES = ['LOBBY', 'QUESTION', 'REVEAL', 'ROUND_SCORE', 'GAME_OVER'] as const;
export const ROOM_VERDICTS = ['CORRECT', 'INCORRECT', 'PASS'] as const;
export const ROOM_ROUND_OPTIONS = [5, 10, 15, 20] as const;
export const ROOM_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;

export const roomStatusEnum = pgEnum('room_status', ROOM_STATUSES);
export const roomPhaseEnum = pgEnum('room_phase', ROOM_PHASES);

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
  category: varchar('category', { length: 80 }).notNull(),
  numRounds: integer('num_rounds').notNull(),
  questionIds: jsonb('question_ids').$type<string[]>().notNull().default([]),
  currentQuestionIndex: integer('current_question_index').notNull().default(0),
  activePlayerId: uuid('active_player_id').references((): AnyPgColumn => roomPlayers.id, {
    onDelete: 'set null',
  }),
  currentAttempt: jsonb('current_attempt').$type<RoomAttempt>(),
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
export const roomCodeSchema = z.string().regex(ROOM_CODE_PATTERN);
export const roomNicknameSchema = z.string().trim().min(1).max(20);
export const roomCategorySchema = z.enum(['All', ...VALID_CATEGORIES]);
export const roomRoundsSchema = z.union([
  z.literal(ROOM_ROUND_OPTIONS[0]),
  z.literal(ROOM_ROUND_OPTIONS[1]),
  z.literal(ROOM_ROUND_OPTIONS[2]),
  z.literal(ROOM_ROUND_OPTIONS[3]),
]);

export type RoomStatus = z.infer<typeof roomStatusSchema>;
export type RoomPhase = z.infer<typeof roomPhaseSchema>;
export type RoomVerdict = z.infer<typeof roomVerdictSchema>;
export type RoomCategory = z.infer<typeof roomCategorySchema>;
export type RoomRounds = z.infer<typeof roomRoundsSchema>;

export const insertRoomSchema = createInsertSchema(rooms, {
  code: roomCodeSchema,
  status: roomStatusSchema.default('lobby'),
  phase: roomPhaseSchema.default('LOBBY'),
  category: roomCategorySchema,
  numRounds: roomRoundsSchema,
  questionIds: z.array(z.string()).default([]),
  currentAttempt: roomAttemptSchema.nullable().optional(),
}).omit({ createdAt: true, updatedAt: true, expiresAt: true });

export const selectRoomSchema = createSelectSchema(rooms, {
  status: roomStatusSchema,
  phase: roomPhaseSchema,
  currentAttempt: roomAttemptSchema.nullable(),
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
  category: roomCategorySchema,
  numRounds: roomRoundsSchema,
  currentQuestionIndex: z.number().int().nonnegative(),
  activePlayerId: z.string().uuid().nullable(),
  currentAttempt: roomAttemptSchema.nullable(),
  players: z.array(roomPlayerSnapshotSchema).max(4),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const roomSnapshotSchema = z.discriminatedUnion('phase', [
  roomSnapshotBaseSchema.extend({
    phase: z.literal('LOBBY'),
    currentQuestion: redactedRoomQuestionSchema.nullable(),
  }),
  roomSnapshotBaseSchema.extend({
    phase: z.literal('QUESTION'),
    currentQuestion: redactedRoomQuestionSchema,
  }),
  roomSnapshotBaseSchema.extend({
    phase: z.literal('REVEAL'),
    currentQuestion: revealedRoomQuestionSchema,
  }),
  roomSnapshotBaseSchema.extend({
    phase: z.literal('ROUND_SCORE'),
    currentQuestion: revealedRoomQuestionSchema,
  }),
  roomSnapshotBaseSchema.extend({
    phase: z.literal('GAME_OVER'),
    currentQuestion: revealedRoomQuestionSchema,
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
  category: roomCategorySchema,
  numRounds: roomRoundsSchema,
});
export const joinRoomRequestSchema = z.object({ nickname: roomNicknameSchema });
export const startRoomRequestSchema = z.object({}).strict();
export const answerRoomRequestSchema = z.object({ answer: z.string().trim().min(1).nullable() });
export const advanceRoomRequestSchema = z.object({}).strict();
export const continueRoomRequestSchema = z.object({}).strict();
export const skipRoomRequestSchema = z.object({}).strict();
export const endRoomRequestSchema = z.object({}).strict();
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

export type RoomCodeParams = z.infer<typeof roomCodeParamsSchema>;
export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;
export type JoinRoomRequest = z.infer<typeof joinRoomRequestSchema>;
export type StartRoomRequest = z.infer<typeof startRoomRequestSchema>;
export type AnswerRoomRequest = z.infer<typeof answerRoomRequestSchema>;
export type AdvanceRoomRequest = z.infer<typeof advanceRoomRequestSchema>;
export type ContinueRoomRequest = z.infer<typeof continueRoomRequestSchema>;
export type SkipRoomRequest = z.infer<typeof skipRoomRequestSchema>;
export type EndRoomRequest = z.infer<typeof endRoomRequestSchema>;
export type PollRoomRequest = z.infer<typeof pollRoomRequestSchema>;
export type CreateRoomResponse = z.infer<typeof createRoomResponseSchema>;
export type JoinRoomResponse = z.infer<typeof joinRoomResponseSchema>;
export type RoomActionResponse = z.infer<typeof roomActionResponseSchema>;
export type StartRoomResponse = RoomActionResponse;
export type AnswerRoomResponse = RoomActionResponse;
export type AdvanceRoomResponse = RoomActionResponse;
export type ContinueRoomResponse = RoomActionResponse;
export type SkipRoomResponse = RoomActionResponse;
export type EndRoomResponse = RoomActionResponse;
export type RoomPollResponse = z.infer<typeof pollRoomResponseSchema>;
export type UnchangedRoomPollResponse = z.infer<typeof unchangedRoomPollResponseSchema>;
export type RoomErrorResponse = z.infer<typeof roomErrorResponseSchema>;
