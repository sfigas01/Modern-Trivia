import { test, expect, type APIResponse } from '@playwright/test';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { questions } from '../shared/models/questions';
import { reviewedBaseballQuestions } from '../server/content/baseball-reviewed';
import type { RoomSnapshot } from '../shared/models/rooms';

// Real server/database path, no AI or route interception. Refuse non-test databases.
// Same disposable trivia_test database as the existing CI E2E job.
test('two players finish 40 source-reviewed questions without live generation', async ({
  request,
}) => {
  test.setTimeout(90_000);
  const url = process.env.THEME_REVIEW_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (
    !url ||
    !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
    new URL(url).pathname !== '/trivia_test'
  ) {
    throw new Error('This E2E requires an explicit local trivia_test PostgreSQL database.');
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const pack = reviewedBaseballQuestions();
  try {
    await drizzle(client).insert(questions).values(pack).onConflictDoNothing();
  } finally {
    await client.end();
  }
  const answers = new Map(pack.map((q) => [q.id, q.acceptableAnswers?.[0] ?? q.answer]));
  async function json<T>(res: APIResponse): Promise<T> {
    expect(res.ok(), `HTTP ${res.status()}`).toBe(true);
    return res.json();
  }
  type Session = { code: string; playerId: string; token: string };
  const host = await json<Session>(
    await request.post('/api/rooms', {
      headers: { 'X-Forwarded-For': '198.51.100.81' },
      data: { nickname: 'ReviewedHost', categories: ['Sports'], numRounds: 5, theme: 'baseball' },
    })
  );
  const guest = await json<Session>(
    await request.post(`/api/rooms/${host.code}/join`, {
      headers: { 'X-Forwarded-For': '198.51.100.82' },
      data: { nickname: 'ReviewedGuest' },
    })
  );
  const tokens = new Map([
    [host.playerId, host.token],
    [guest.playerId, guest.token],
  ]);
  const headers = (id = host.playerId) => ({
    'X-Player-Token': tokens.get(id)!,
    'X-Forwarded-For': id === host.playerId ? '198.51.100.81' : '198.51.100.82',
  });
  const get = () =>
    request.get(`/api/rooms/${host.code}`, { headers: headers() }).then(json<RoomSnapshot>);
  await json(
    await request.post(`/api/rooms/${host.code}/theme-start`, { headers: headers(), data: {} })
  );
  await expect.poll(async () => (await get()).phase).toBe('QUESTION');
  let snapshot = await get();
  const played = new Set<string>();
  for (let step = 0; step < 100 && snapshot.phase !== 'GAME_OVER'; step++) {
    let action: string;
    let data: Record<string, unknown> = {};
    if (snapshot.phase === 'QUESTION') {
      const id = snapshot.currentQuestion!.id;
      expect(played.has(id)).toBe(false);
      expect(answers.has(id)).toBe(true);
      played.add(id);
      action = 'answer';
      data = { answer: answers.get(id) };
    } else if (snapshot.phase === 'REVEAL') {
      action = 'advance';
    } else if (snapshot.phase === 'ROUND_SCORE') {
      action = 'continue';
    } else {
      throw new Error(`Unexpected phase ${snapshot.phase}`);
    }
    const actor = action === 'continue' ? host.playerId : snapshot.activePlayerId!;
    snapshot = (
      await json<{ snapshot: RoomSnapshot }>(
        await request.post(`/api/rooms/${host.code}/${action}`, { headers: headers(actor), data })
      )
    ).snapshot;
    if (action === 'answer') expect(snapshot.currentAttempt?.verdict).toBe('CORRECT');
  }
  expect(snapshot.phase).toBe('GAME_OVER');
  expect(played.size).toBe(40);
  expect(snapshot.players.map((p) => p.questionCount)).toEqual([20, 20]);
  expect(snapshot.players.every((p) => p.score > 0)).toBe(true);
  const guestView = await json<RoomSnapshot>(
    await request.get(`/api/rooms/${host.code}`, { headers: headers(guest.playerId) })
  );
  expect(guestView.phase).toBe('GAME_OVER');
  expect(guestView.players.map((p) => p.score)).toEqual(snapshot.players.map((p) => p.score));
});
