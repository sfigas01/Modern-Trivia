import { randomBytes, randomInt } from 'crypto';
import type { Express, Request, Response } from 'express';
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from './db';
import { advanceRoomEngine, createRoomAttempt } from './lib/room-engine';
import type { AuthenticatedRequest } from './types';
import { QUESTIONS_PER_TEAM_ROTATION, type Question as AnswerQuestion } from '@shared/lib/answers';
import {
  advanceRoomRequestSchema,
  advanceRoomResponseSchema,
  answerRoomRequestSchema,
  answerRoomResponseSchema,
  continueRoomRequestSchema,
  continueRoomResponseSchema,
  createRoomRequestSchema,
  createRoomResponseSchema,
  endRoomRequestSchema,
  endRoomResponseSchema,
  joinRoomRequestSchema,
  joinRoomResponseSchema,
  pollRoomRequestSchema,
  questions,
  roomCodeParamsSchema,
  roomPlayers,
  roomSnapshotSchema,
  rooms,
  seenQuestions,
  startRoomRequestSchema,
  startRoomResponseSchema,
  unchangedRoomPollResponseSchema,
  type Question,
  type Room,
  type RoomPlayer,
  type RoomSnapshot,
} from '@shared/schema';

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_ROOM_CODE_ATTEMPTS = 5;
const MAX_PLAYERS = 4;
const LOBBY_TTL_MS = 2 * 60 * 60 * 1000;
const ACTIVE_TTL_MS = 24 * 60 * 60 * 1000;
const ROOM_CODE_CONSTRAINT = 'rooms_code_unique';
const ROOM_NICKNAME_CONSTRAINT = 'uq_room_players_room_nickname_ci';

type RoomReadDatabase = Pick<typeof db, 'select'>;

class RoomRouteError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

type PostgresError = Error & { code?: string; constraint?: string };

function hasConstraint(error: unknown, constraint: string): boolean {
  const postgresError = error as PostgresError;
  return postgresError?.code === '23505' && postgresError.constraint === constraint;
}

export function generateRoomCode(): string {
  return Array.from(
    { length: 5 },
    () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]
  ).join('');
}

function generatePlayerToken(): string {
  return randomBytes(32).toString('base64url');
}

function parseRoomCode(rawCode: string): string {
  return roomCodeParamsSchema.parse({ code: rawCode.toUpperCase() }).code;
}

function isExpired(room: Room, now = new Date()): boolean {
  return room.expiresAt.getTime() <= now.getTime();
}

function getUserId(req: Request): string | undefined {
  return (req as AuthenticatedRequest).user?.claims?.sub;
}

function requireHost(player: RoomPlayer, room: Room): void {
  if (!player.isHost || player.id !== room.hostPlayerId) {
    throw new RoomRouteError(403, 'Host token required');
  }
}

function toAnswerQuestion(question: Question): AnswerQuestion {
  return {
    id: question.id,
    category: question.category,
    difficulty: z.enum(['Easy', 'Medium', 'Hard']).parse(question.difficulty),
    question: question.question,
    answer: question.answer,
    acceptableAnswers: question.acceptableAnswers ?? [],
    explanation: question.explanation,
    pillar: question.pillar,
    tags: question.tags ?? [],
    sourceUrl: question.sourceUrl ?? undefined,
    sourceName: question.sourceName ?? undefined,
  };
}

function serializePlayer(player: RoomPlayer) {
  return {
    id: player.id,
    nickname: player.nickname,
    joinOrder: player.joinOrder,
    score: player.score,
    questionCount: player.questionCount,
    lastRoundDelta: player.lastRoundDelta,
    isHost: player.isHost,
    lastSeenAt: player.lastSeenAt.toISOString(),
    leftAt: player.leftAt?.toISOString() ?? null,
  };
}

async function buildRoomSnapshot(database: RoomReadDatabase, room: Room): Promise<RoomSnapshot> {
  const players = await database
    .select()
    .from(roomPlayers)
    .where(eq(roomPlayers.roomId, room.id))
    .orderBy(asc(roomPlayers.joinOrder));

  let currentQuestion: Record<string, unknown> | null = null;
  const questionId =
    room.phase === 'QUESTION'
      ? room.questionIds[room.currentQuestionIndex]
      : (room.currentAttempt?.questionId ?? room.questionIds[room.currentQuestionIndex]);

  if (room.phase !== 'LOBBY' && questionId) {
    const [question] = await database
      .select()
      .from(questions)
      .where(eq(questions.id, questionId))
      .limit(1);

    if (!question) {
      throw new Error(`Room question not found: ${questionId}`);
    }

    const baseQuestion = {
      id: question.id,
      category: question.category,
      difficulty: question.difficulty,
      question: question.question,
      pillar: question.pillar,
      tags: question.tags ?? [],
      // Raw source URLs and names can disclose the answer through an article title.
      sourceUrl: null,
      sourceName: null,
    };

    currentQuestion =
      room.phase === 'QUESTION'
        ? baseQuestion
        : {
            ...baseQuestion,
            sourceUrl: question.sourceUrl,
            sourceName: question.sourceName,
            answer: question.answer,
            acceptableAnswers: question.acceptableAnswers ?? [],
            explanation: question.explanation,
          };
  }

  return roomSnapshotSchema.parse({
    id: room.id,
    code: room.code,
    status: room.status,
    phase: room.phase,
    version: room.version,
    hostPlayerId: room.hostPlayerId,
    category: room.category,
    numRounds: room.numRounds,
    currentQuestionIndex: room.currentQuestionIndex,
    activePlayerId: room.activePlayerId,
    currentAttempt: room.currentAttempt,
    currentQuestion,
    players: players.map(serializePlayer),
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
    expiresAt: room.expiresAt.toISOString(),
  });
}

export async function authenticateRoomPlayer(
  req: Request,
  roomId: string,
  database: RoomReadDatabase = db
): Promise<RoomPlayer> {
  const token = req.get('X-Player-Token');
  if (!token) {
    throw new RoomRouteError(401, 'Player token required');
  }

  const [player] = await database
    .select()
    .from(roomPlayers)
    .where(
      and(eq(roomPlayers.roomId, roomId), eq(roomPlayers.token, token), isNull(roomPlayers.leftAt))
    )
    .limit(1);

  if (!player) {
    throw new RoomRouteError(401, 'Invalid player token');
  }

  return player;
}

function sendRoomError(res: Response, error: unknown, context: string) {
  if (error instanceof z.ZodError) {
    return res.status(422).json({ message: 'Invalid room data', errors: error.errors });
  }

  if (error instanceof RoomRouteError) {
    return res.status(error.status).json({ message: error.message });
  }

  console.error(context, error);
  return res.status(500).json({ message: 'Internal server error' });
}

export function registerRoomRoutes(app: Express): void {
  app.post('/api/rooms', async (req, res) => {
    try {
      const input = createRoomRequestSchema.parse(req.body);
      const now = new Date();

      // Only lobby rooms use the short two-hour expiry. Active rooms are
      // extended by the start transition and must not be removed by this cleanup.
      await db
        .delete(rooms)
        .where(and(eq(rooms.status, 'lobby'), eq(rooms.phase, 'LOBBY'), lte(rooms.expiresAt, now)));

      for (let attempt = 0; attempt < MAX_ROOM_CODE_ATTEMPTS; attempt++) {
        const code = generateRoomCode();
        const token = generatePlayerToken();

        try {
          const created = await db.transaction(async (tx) => {
            const [room] = await tx
              .insert(rooms)
              .values({
                code,
                category: input.category,
                numRounds: input.numRounds,
                status: 'lobby',
                phase: 'LOBBY',
                expiresAt: new Date(now.getTime() + LOBBY_TTL_MS),
              })
              .returning();

            const [host] = await tx
              .insert(roomPlayers)
              .values({
                roomId: room.id,
                nickname: input.nickname,
                token,
                joinOrder: 0,
                isHost: true,
              })
              .returning();

            await tx.update(rooms).set({ hostPlayerId: host.id }).where(eq(rooms.id, room.id));

            return { room, host };
          });

          return res.status(201).json(
            createRoomResponseSchema.parse({
              code: created.room.code,
              playerId: created.host.id,
              token: created.host.token,
            })
          );
        } catch (error) {
          if (hasConstraint(error, ROOM_CODE_CONSTRAINT)) {
            continue;
          }
          throw error;
        }
      }

      throw new Error('Unable to generate a unique room code after five attempts');
    } catch (error) {
      return sendRoomError(res, error, 'Error creating room:');
    }
  });

  app.post('/api/rooms/:code/join', async (req, res) => {
    try {
      const code = parseRoomCode(req.params.code);
      const input = joinRoomRequestSchema.parse(req.body);

      let joined: { player: RoomPlayer; room: Room };
      try {
        joined = await db.transaction(async (tx) => {
          const [room] = await tx
            .select()
            .from(rooms)
            .where(eq(rooms.code, code))
            .limit(1)
            .for('update');

          if (!room) {
            throw new RoomRouteError(404, 'Room not found');
          }
          if (isExpired(room)) {
            throw new RoomRouteError(404, 'Room expired');
          }
          if (room.status !== 'lobby' || room.phase !== 'LOBBY') {
            throw new RoomRouteError(409, 'Game has already started');
          }

          const allPlayers = await tx
            .select()
            .from(roomPlayers)
            .where(eq(roomPlayers.roomId, room.id))
            .orderBy(asc(roomPlayers.joinOrder));

          const activePlayers = allPlayers.filter((player) => player.leftAt === null);

          if (activePlayers.length >= MAX_PLAYERS) {
            throw new RoomRouteError(409, 'Room is full');
          }
          if (
            activePlayers.some(
              (player) => player.nickname.toLocaleLowerCase() === input.nickname.toLocaleLowerCase()
            )
          ) {
            throw new RoomRouteError(409, 'Nickname is already taken');
          }

          const [player] = await tx
            .insert(roomPlayers)
            .values({
              roomId: room.id,
              nickname: input.nickname,
              token: generatePlayerToken(),
              joinOrder: (allPlayers.at(-1)?.joinOrder ?? -1) + 1,
              isHost: false,
            })
            .returning();

          const [updatedRoom] = await tx
            .update(rooms)
            .set({
              version: sql`${rooms.version} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(rooms.id, room.id))
            .returning();

          return { player, room: updatedRoom };
        });
      } catch (error) {
        if (hasConstraint(error, ROOM_NICKNAME_CONSTRAINT)) {
          throw new RoomRouteError(409, 'Nickname is already taken');
        }
        throw error;
      }

      const snapshot = await buildRoomSnapshot(db, joined.room);
      return res.json(
        joinRoomResponseSchema.parse({
          playerId: joined.player.id,
          token: joined.player.token,
          snapshot,
        })
      );
    } catch (error) {
      return sendRoomError(res, error, 'Error joining room:');
    }
  });

  app.post('/api/rooms/:code/start', async (req, res) => {
    try {
      const code = parseRoomCode(req.params.code);
      startRoomRequestSchema.parse(req.body);
      const userId = getUserId(req);

      const updatedRoom = await db.transaction(async (tx) => {
        const [room] = await tx
          .select()
          .from(rooms)
          .where(eq(rooms.code, code))
          .limit(1)
          .for('update');

        if (!room) {
          throw new RoomRouteError(404, 'Room not found');
        }
        if (isExpired(room)) {
          throw new RoomRouteError(404, 'Room expired');
        }
        if (room.status !== 'lobby' || room.phase !== 'LOBBY') {
          throw new RoomRouteError(409, 'Game has already started');
        }

        const actor = await authenticateRoomPlayer(req, room.id, tx);
        requireHost(actor, room);

        const players = await tx
          .select()
          .from(roomPlayers)
          .where(and(eq(roomPlayers.roomId, room.id), isNull(roomPlayers.leftAt)))
          .orderBy(asc(roomPlayers.joinOrder));

        if (players.length < 2) {
          throw new RoomRouteError(409, 'At least two players are required to start');
        }

        const questionLimit = room.numRounds * players.length * QUESTIONS_PER_TEAM_ROTATION;
        const questionConditions = [eq(questions.status, 'approved')];
        if (room.category !== 'All') {
          questionConditions.push(eq(questions.category, room.category));
        }

        let selectedQuestions: { id: string }[];
        if (userId) {
          const cooldownExpr = sql`
            CASE (${seenQuestions.seenCount} - 1) % 3
              WHEN 0 THEN INTERVAL '1 month'
              WHEN 1 THEN INTERVAL '3 months'
              WHEN 2 THEN INTERVAL '5 months'
            END
          `;
          selectedQuestions = await tx
            .select({ id: questions.id })
            .from(questions)
            .leftJoin(
              seenQuestions,
              and(eq(questions.id, seenQuestions.questionId), eq(seenQuestions.userId, userId))
            )
            .where(
              and(
                ...questionConditions,
                sql`(${seenQuestions.questionId} IS NULL OR ${seenQuestions.seenAt} + ${cooldownExpr} <= NOW())`
              )
            )
            .orderBy(
              sql`CASE WHEN ${seenQuestions.questionId} IS NULL THEN 0 ELSE 1 END`,
              sql`random()`
            )
            .limit(questionLimit);
        } else {
          selectedQuestions = await tx
            .select({ id: questions.id })
            .from(questions)
            .where(and(...questionConditions))
            .orderBy(sql`random()`)
            .limit(questionLimit);
        }

        if (selectedQuestions.length < questionLimit) {
          throw new RoomRouteError(409, 'Not enough approved questions to start this game');
        }

        const [startedRoom] = await tx
          .update(rooms)
          .set({
            status: 'active',
            phase: 'QUESTION',
            questionIds: selectedQuestions.map((question) => question.id),
            currentQuestionIndex: 0,
            activePlayerId: players[0].id,
            currentAttempt: null,
            expiresAt: new Date(Date.now() + ACTIVE_TTL_MS),
            version: sql`${rooms.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(rooms.id, room.id),
              eq(rooms.status, 'lobby'),
              eq(rooms.phase, 'LOBBY'),
              eq(rooms.hostPlayerId, actor.id)
            )
          )
          .returning();

        if (!startedRoom) {
          throw new RoomRouteError(409, 'Room state changed before the game could start');
        }
        return startedRoom;
      });

      return res.json(
        startRoomResponseSchema.parse({ snapshot: await buildRoomSnapshot(db, updatedRoom) })
      );
    } catch (error) {
      return sendRoomError(res, error, 'Error starting room:');
    }
  });

  app.post('/api/rooms/:code/answer', async (req, res) => {
    try {
      const code = parseRoomCode(req.params.code);
      const input = answerRoomRequestSchema.parse(req.body);

      const updatedRoom = await db.transaction(async (tx) => {
        const [room] = await tx
          .select()
          .from(rooms)
          .where(eq(rooms.code, code))
          .limit(1)
          .for('update');

        if (!room) {
          throw new RoomRouteError(404, 'Room not found');
        }
        if (isExpired(room)) {
          throw new RoomRouteError(404, 'Room expired');
        }
        if (room.phase !== 'QUESTION' || room.status !== 'active') {
          throw new RoomRouteError(409, 'Room is not accepting answers');
        }

        const actor = await authenticateRoomPlayer(req, room.id, tx);
        if (actor.id !== room.activePlayerId) {
          throw new RoomRouteError(403, 'Only the active player can answer');
        }

        const questionId = room.questionIds[room.currentQuestionIndex];
        const [question] = await tx
          .select()
          .from(questions)
          .where(eq(questions.id, questionId))
          .limit(1);
        if (!question) {
          throw new Error(`Room question not found: ${questionId}`);
        }

        const currentAttempt = createRoomAttempt(
          actor.id,
          input.answer,
          toAnswerQuestion(question)
        );
        const [answeredRoom] = await tx
          .update(rooms)
          .set({
            phase: 'REVEAL',
            currentAttempt,
            version: sql`${rooms.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(rooms.id, room.id),
              eq(rooms.status, 'active'),
              eq(rooms.phase, 'QUESTION'),
              eq(rooms.activePlayerId, actor.id)
            )
          )
          .returning();

        if (!answeredRoom) {
          throw new RoomRouteError(409, 'Room state changed before the answer was accepted');
        }
        return answeredRoom;
      });

      return res.json(
        answerRoomResponseSchema.parse({ snapshot: await buildRoomSnapshot(db, updatedRoom) })
      );
    } catch (error) {
      return sendRoomError(res, error, 'Error answering room question:');
    }
  });

  app.post('/api/rooms/:code/advance', async (req, res) => {
    try {
      const code = parseRoomCode(req.params.code);
      advanceRoomRequestSchema.parse(req.body);

      const updatedRoom = await db.transaction(async (tx) => {
        const [room] = await tx
          .select()
          .from(rooms)
          .where(eq(rooms.code, code))
          .limit(1)
          .for('update');

        if (!room) {
          throw new RoomRouteError(404, 'Room not found');
        }
        if (isExpired(room)) {
          throw new RoomRouteError(404, 'Room expired');
        }
        if (room.phase !== 'REVEAL' || room.status !== 'active' || !room.currentAttempt) {
          throw new RoomRouteError(409, 'Room is not ready to advance');
        }

        const actor = await authenticateRoomPlayer(req, room.id, tx);
        if (actor.id !== room.activePlayerId && actor.id !== room.hostPlayerId) {
          throw new RoomRouteError(403, 'Only the active player or host can advance');
        }

        const players = await tx
          .select()
          .from(roomPlayers)
          .where(and(eq(roomPlayers.roomId, room.id), isNull(roomPlayers.leftAt)))
          .orderBy(asc(roomPlayers.joinOrder));
        const transition = advanceRoomEngine({
          activePlayerId: room.activePlayerId ?? '',
          currentAttempt: room.currentAttempt,
          currentQuestionIndex: room.currentQuestionIndex,
          players,
          questionCount: room.questionIds.length,
        });

        const [advancedRoom] = await tx
          .update(rooms)
          .set({
            status: transition.phase === 'GAME_OVER' ? 'finished' : 'active',
            phase: transition.phase,
            currentQuestionIndex: transition.currentQuestionIndex,
            activePlayerId: transition.activePlayerId,
            version: sql`${rooms.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(rooms.id, room.id),
              eq(rooms.status, 'active'),
              eq(rooms.phase, 'REVEAL'),
              or(eq(rooms.activePlayerId, actor.id), eq(rooms.hostPlayerId, actor.id))
            )
          )
          .returning();

        if (!advancedRoom) {
          throw new RoomRouteError(409, 'Room state changed before it could advance');
        }

        for (const player of transition.players) {
          await tx
            .update(roomPlayers)
            .set({
              score: player.score,
              questionCount: player.questionCount,
              lastRoundDelta: player.lastRoundDelta,
            })
            .where(and(eq(roomPlayers.id, player.id), eq(roomPlayers.roomId, room.id)));
        }

        return advancedRoom;
      });

      return res.json(
        advanceRoomResponseSchema.parse({ snapshot: await buildRoomSnapshot(db, updatedRoom) })
      );
    } catch (error) {
      return sendRoomError(res, error, 'Error advancing room:');
    }
  });

  app.post('/api/rooms/:code/continue', async (req, res) => {
    try {
      const code = parseRoomCode(req.params.code);
      continueRoomRequestSchema.parse(req.body);

      const updatedRoom = await db.transaction(async (tx) => {
        const [room] = await tx
          .select()
          .from(rooms)
          .where(eq(rooms.code, code))
          .limit(1)
          .for('update');
        if (!room) {
          throw new RoomRouteError(404, 'Room not found');
        }
        if (isExpired(room)) {
          throw new RoomRouteError(404, 'Room expired');
        }
        if (room.phase !== 'ROUND_SCORE' || room.status !== 'active') {
          throw new RoomRouteError(409, 'Room is not ready for the next round');
        }

        const actor = await authenticateRoomPlayer(req, room.id, tx);
        requireHost(actor, room);
        const [continuedRoom] = await tx
          .update(rooms)
          .set({
            phase: 'QUESTION',
            currentAttempt: null,
            version: sql`${rooms.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(rooms.id, room.id),
              eq(rooms.status, 'active'),
              eq(rooms.phase, 'ROUND_SCORE'),
              eq(rooms.hostPlayerId, actor.id)
            )
          )
          .returning();
        if (!continuedRoom) {
          throw new RoomRouteError(409, 'Room state changed before the next round');
        }
        return continuedRoom;
      });

      return res.json(
        continueRoomResponseSchema.parse({ snapshot: await buildRoomSnapshot(db, updatedRoom) })
      );
    } catch (error) {
      return sendRoomError(res, error, 'Error continuing room:');
    }
  });

  app.post('/api/rooms/:code/end', async (req, res) => {
    try {
      const code = parseRoomCode(req.params.code);
      endRoomRequestSchema.parse(req.body);

      const updatedRoom = await db.transaction(async (tx) => {
        const [room] = await tx
          .select()
          .from(rooms)
          .where(eq(rooms.code, code))
          .limit(1)
          .for('update');
        if (!room) {
          throw new RoomRouteError(404, 'Room not found');
        }
        if (isExpired(room)) {
          throw new RoomRouteError(404, 'Room expired');
        }
        if (room.status === 'finished' || room.status === 'abandoned') {
          throw new RoomRouteError(409, 'Room has already ended');
        }

        const actor = await authenticateRoomPlayer(req, room.id, tx);
        requireHost(actor, room);
        const isLobby = room.phase === 'LOBBY';
        const [endedRoom] = await tx
          .update(rooms)
          .set({
            status: isLobby ? 'abandoned' : 'finished',
            phase: isLobby ? 'LOBBY' : 'GAME_OVER',
            version: sql`${rooms.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(rooms.id, room.id),
              eq(rooms.phase, room.phase),
              eq(rooms.hostPlayerId, actor.id)
            )
          )
          .returning();
        if (!endedRoom) {
          throw new RoomRouteError(409, 'Room state changed before it could end');
        }
        return endedRoom;
      });

      return res.json(
        endRoomResponseSchema.parse({ snapshot: await buildRoomSnapshot(db, updatedRoom) })
      );
    } catch (error) {
      return sendRoomError(res, error, 'Error ending room:');
    }
  });

  app.get('/api/rooms/:code', async (req, res) => {
    try {
      const code = parseRoomCode(req.params.code);
      const { sinceVersion } = pollRoomRequestSchema.parse(req.query);
      const [room] = await db.select().from(rooms).where(eq(rooms.code, code)).limit(1);

      if (!room) {
        throw new RoomRouteError(404, 'Room not found');
      }
      if (isExpired(room)) {
        throw new RoomRouteError(404, 'Room expired');
      }

      const player = await authenticateRoomPlayer(req, room.id);
      await db
        .update(roomPlayers)
        .set({ lastSeenAt: new Date() })
        .where(eq(roomPlayers.id, player.id));

      if (sinceVersion === room.version) {
        return res.json(unchangedRoomPollResponseSchema.parse({ changed: false }));
      }

      return res.json(await buildRoomSnapshot(db, room));
    } catch (error) {
      return sendRoomError(res, error, 'Error polling room:');
    }
  });
}
