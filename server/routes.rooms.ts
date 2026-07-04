import { randomBytes, randomInt } from 'crypto';
import type { Express, Request, Response } from 'express';
import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from './db';
import {
  createRoomRequestSchema,
  createRoomResponseSchema,
  joinRoomRequestSchema,
  joinRoomResponseSchema,
  pollRoomRequestSchema,
  questions,
  roomCodeParamsSchema,
  roomPlayers,
  roomSnapshotSchema,
  rooms,
  unchangedRoomPollResponseSchema,
  type Room,
  type RoomPlayer,
  type RoomSnapshot,
} from '@shared/schema';

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_ROOM_CODE_ATTEMPTS = 5;
const MAX_PLAYERS = 4;
const LOBBY_TTL_MS = 2 * 60 * 60 * 1000;
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
  const questionId = room.questionIds[room.currentQuestionIndex];

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

      await db.delete(rooms).where(lte(rooms.expiresAt, now));

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

          const existingPlayers = await tx
            .select()
            .from(roomPlayers)
            .where(and(eq(roomPlayers.roomId, room.id), isNull(roomPlayers.leftAt)))
            .orderBy(asc(roomPlayers.joinOrder));

          if (existingPlayers.length >= MAX_PLAYERS) {
            throw new RoomRouteError(409, 'Room is full');
          }
          if (
            existingPlayers.some(
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
              joinOrder: existingPlayers.length,
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
