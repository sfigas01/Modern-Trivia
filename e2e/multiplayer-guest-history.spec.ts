import { expect, test, type APIRequestContext } from '@playwright/test';
import { Pool } from 'pg';

import { loadEnvironment } from '../server/lib/env';

// STE-273: a guest who has seen questions in their own games must not be served
// those questions when they join someone else's room. The server unit tests use
// mocked query results, so this end-to-end spec covers the real integration:
// browser localStorage -> join request -> server-side room selection.
//
// A dedicated pool (not server/db's shared singleton) is used so this file's
// teardown never races another spec that ends the shared pool.
loadEnvironment();
const db = new Pool({ connectionString: process.env.DATABASE_URL });

const GUEST_SEEN_KEY = 'modern-trivia:guest-seen:v1';
// Namespaced ids so the assertions are unaffected by any other approved
// questions already in the database.
const SEEN_IDS = Array.from({ length: 10 }, (_, i) => `ste273-seen-${i}`);
// Enough never-seen supply that a 40-question game (5 rounds x 2 players x 4)
// can be filled entirely from unseen questions, so the seen ids are excluded.
const FRESH_IDS = Array.from({ length: 45 }, (_, i) => `ste273-fresh-${i}`);
const ALL_IDS = [...SEEN_IDS, ...FRESH_IDS];

interface CreateRoomResponse {
  code: string;
  playerId: string;
  token: string;
}

async function seedApprovedQuestion(id: string) {
  await db.query(
    `INSERT INTO questions (
       id, category, difficulty, question, answer, acceptable_answers, explanation,
       pillar, tags, source_url, source_name, status
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb, $10, $11, $12)
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
    [
      id,
      'Science & Nature',
      'Easy',
      `STE-273 fixture question ${id}?`,
      'Answer',
      JSON.stringify([]),
      'Fixture question for guest-history exclusion.',
      'GlobalEh',
      JSON.stringify(['GlobalEh']),
      'https://example.com/ste273',
      'STE-273 fixture',
      'approved',
    ]
  );
}

const createdRoomCodes: string[] = [];

async function createRoom(request: APIRequestContext, nickname: string) {
  const response = await request.post('/api/rooms', {
    data: { nickname, categories: ['All'], numRounds: 5 },
  });
  const body = await response.text();
  expect(response.ok(), `create room failed (${response.status()}): ${body}`).toBeTruthy();
  const room = JSON.parse(body) as CreateRoomResponse;
  createdRoomCodes.push(room.code);
  return room;
}

test.describe('guest join seen-question history (STE-273)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    for (const id of ALL_IDS) await seedApprovedQuestion(id);
  });

  test.afterAll(async () => {
    if (createdRoomCodes.length > 0) {
      await db.query('DELETE FROM rooms WHERE code = ANY($1)', [createdRoomCodes]);
    }
    await db.query('DELETE FROM seen_questions WHERE question_id = ANY($1)', [ALL_IDS]);
    await db.query('DELETE FROM questions WHERE id = ANY($1)', [ALL_IDS]);
    await db.end();
  });

  test('a guest is not served questions their browser has already seen', async ({
    browser,
    request,
  }, testInfo) => {
    test.setTimeout(60_000);

    const subnet = (process.pid % 200) + 1;
    const guestIp = `198.52.${subnet}.${20 + testInfo.repeatEachIndex}`;
    const baseURL = String(testInfo.project.use.baseURL);

    // Guest host created over the API; the joining guest is what carries the
    // seen-question history under test.
    const host = await createRoom(request, 'STE273Host');

    const guestContext = await browser.newContext({
      baseURL,
      extraHTTPHeaders: { 'X-Forwarded-For': guestIp },
    });
    // Seed the guest's local seen-history before any app code runs, so the join
    // flow reads and sends it exactly as a returning player's browser would.
    await guestContext.addInitScript(
      ([key, ids]) => {
        window.localStorage.setItem(key as string, JSON.stringify(ids));
      },
      [GUEST_SEEN_KEY, SEEN_IDS] as const
    );

    const guestPage = await guestContext.newPage();
    try {
      await guestPage.goto(`/join/${host.code}`);
      await guestPage.getByTestId('input-nickname').fill('STE273Guest');

      const joinResponsePromise = guestPage.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/rooms/${host.code}/join`) &&
          response.request().method() === 'POST'
      );
      await guestPage.getByTestId('button-join-room').click();
      const joinResponse = await joinResponsePromise;
      expect(joinResponse.ok(), `guest join failed (${joinResponse.status()})`).toBeTruthy();

      // The joining guest's stored list must have reached the server.
      const storedGuestSeen = await db.query<{ guest_seen_ids: string[] | null }>(
        `SELECT guest_seen_ids FROM room_players
           WHERE room_id = (SELECT id FROM rooms WHERE code = $1) AND is_host = false`,
        [host.code]
      );
      expect(storedGuestSeen.rows[0]?.guest_seen_ids ?? []).toEqual(
        expect.arrayContaining(SEEN_IDS)
      );

      const startResponse = await request.post(`/api/rooms/${host.code}/start`, {
        headers: { 'X-Player-Token': host.token },
        data: {},
      });
      const startBody = await startResponse.text();
      expect(
        startResponse.ok(),
        `start failed (${startResponse.status()}): ${startBody}`
      ).toBeTruthy();

      const selected = await db.query<{ question_ids: string[] }>(
        'SELECT question_ids FROM rooms WHERE code = $1',
        [host.code]
      );
      const questionIds = selected.rows[0].question_ids;
      // A full game was selected, and none of it is a question the guest had
      // already seen — unseen supply was ample.
      expect(questionIds).toHaveLength(40);
      for (const seenId of SEEN_IDS) {
        expect(questionIds).not.toContain(seenId);
      }
    } finally {
      await guestContext.close().catch(() => undefined);
    }
  });
});
