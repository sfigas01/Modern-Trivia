import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';

import { pool } from '../server/db';

const disputeQuestion = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/dispute-question.json', import.meta.url)), 'utf8')
) as {
  id: string;
  category: string;
  difficulty: 'Easy';
  question: string;
  answer: string;
  acceptableAnswers: string[];
  explanation: string;
  pillar: string;
  tags: string[];
  sourceUrl: string;
  sourceName: string;
  status: string;
};

const questionCatalog = { questions: [disputeQuestion], categories: [disputeQuestion.category] };
const INCORRECT_ANSWER = 'definitely-not-water';
const DISPUTE_EXPLANATION = 'The fixture answer should be accepted for this deterministic test.';
const QUESTIONS_IN_FIVE_ROUND_THREE_PLAYER_GAME = 60;

interface PlayerSession {
  playerId: string;
  token: string;
}

interface CreateRoomResponse extends PlayerSession {
  code: string;
}

interface RoomPlayer {
  id: string;
  nickname: string;
  score: number;
}

interface DisputeVoteSnapshot {
  disputeId: string;
  status: 'OPEN' | 'FINALIZED';
  submittedVoterIds: string[];
  threshold: number;
  outcome?: 'approved' | 'rejected' | 'tied' | 'expired' | 'canceled';
  originalPointsDelta?: number;
  finalPointsDelta?: number;
}

interface RoomSnapshot {
  version: number;
  phase: 'LOBBY' | 'QUESTION' | 'REVEAL' | 'DISPUTE_VOTE' | 'ROUND_SCORE' | 'GAME_OVER';
  currentQuestionIndex: number;
  opponentDisputeVotingEnabled: boolean;
  activeDisputeId: string | null;
  currentAttempt: {
    playerId: string;
    verdict: 'CORRECT' | 'INCORRECT' | 'PASS';
    pointsDelta: number;
  } | null;
  currentQuestion: { id: string; difficulty: 'Easy' | 'Medium' | 'Hard' } | null;
  currentDisputeVote: DisputeVoteSnapshot | null;
  players: RoomPlayer[];
}

interface RoomActionResponse {
  snapshot: RoomSnapshot;
}

interface GameDriver {
  contexts: BrowserContext[];
  pages: [Page, Page, Page];
  host: CreateRoomResponse;
  voters: [PlayerSession, PlayerSession];
  ips: [string, string, string];
  close: () => Promise<void>;
}

interface PersistedDispute {
  id: string;
  voting_enabled: boolean;
  eligible_voter_snapshot: Array<{ playerId: string; displayName: string }> | null;
  threshold: number | null;
  outcome: string | null;
  original_points_delta: number | null;
  final_points_delta: number | null;
  decided_at: Date | null;
}

interface PersistedBallot {
  voter_player_id: string;
  voter_player_name: string;
  approve: boolean;
  cast_at: Date;
}

async function installQuestionFixture(context: BrowserContext) {
  await context.route('**/api/questions**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(questionCatalog),
      });
      return;
    }
    await route.continue();
  });

  await context.route('**/api/questions/seen', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function readJson<T>(response: APIResponse, label: string): Promise<T> {
  const body = await response.text();
  expect(response.ok(), `${label} failed (${response.status()}): ${body}`).toBeTruthy();
  return JSON.parse(body) as T;
}

async function getSnapshot(
  request: APIRequestContext,
  code: string,
  token: string,
  clientIp: string
): Promise<RoomSnapshot> {
  const response = await request.get(`/api/rooms/${code}`, {
    headers: { 'X-Player-Token': token, 'X-Forwarded-For': clientIp },
  });
  return readJson<RoomSnapshot>(response, `GET /api/rooms/${code}`);
}

async function postRoomAction(
  request: APIRequestContext,
  code: string,
  action: 'advance' | 'award-dispute' | 'disputes' | 'disputes/vote',
  token: string,
  clientIp: string,
  data: Record<string, unknown> = {}
): Promise<APIResponse> {
  return request.post(`/api/rooms/${code}/${action}`, {
    headers: { 'X-Player-Token': token, 'X-Forwarded-For': clientIp },
    data,
  });
}

async function seedDeterministicQuestion() {
  await pool.query(
    `INSERT INTO questions (
       id, category, difficulty, question, answer, acceptable_answers, explanation,
       pillar, tags, source_url, source_name, status
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb, $10, $11, $12)
     ON CONFLICT (id) DO UPDATE SET
       category = EXCLUDED.category,
       difficulty = EXCLUDED.difficulty,
       question = EXCLUDED.question,
       answer = EXCLUDED.answer,
       acceptable_answers = EXCLUDED.acceptable_answers,
       explanation = EXCLUDED.explanation,
       pillar = EXCLUDED.pillar,
       tags = EXCLUDED.tags,
       source_url = EXCLUDED.source_url,
       source_name = EXCLUDED.source_name,
       status = EXCLUDED.status`,
    [
      disputeQuestion.id,
      disputeQuestion.category,
      disputeQuestion.difficulty,
      disputeQuestion.question,
      disputeQuestion.answer,
      JSON.stringify(disputeQuestion.acceptableAnswers),
      disputeQuestion.explanation,
      disputeQuestion.pillar,
      JSON.stringify(disputeQuestion.tags),
      disputeQuestion.sourceUrl,
      disputeQuestion.sourceName,
      disputeQuestion.status,
    ]
  );
}

async function pinRoomToFixture(code: string) {
  const questionIds = Array(QUESTIONS_IN_FIVE_ROUND_THREE_PLAYER_GAME).fill(disputeQuestion.id);
  const result = await pool.query(
    `UPDATE rooms
       SET question_ids = $1::jsonb, version = version + 1, updated_at = NOW()
     WHERE code = $2`,
    [JSON.stringify(questionIds), code]
  );
  expect(result.rowCount, `fixture room ${code} was not found`).toBe(1);
}

async function readQaEvidence(code: string) {
  const disputeResult = await pool.query<PersistedDispute>(
    `SELECT id, voting_enabled, eligible_voter_snapshot, threshold, outcome,
            original_points_delta, final_points_delta, decided_at
       FROM disputes
      WHERE room_code = $1
      ORDER BY timestamp DESC
      LIMIT 1`,
    [code]
  );
  expect(disputeResult.rowCount, `no QA dispute evidence for room ${code}`).toBe(1);
  const dispute = disputeResult.rows[0];
  const ballotResult = await pool.query<PersistedBallot>(
    `SELECT voter_player_id, voter_player_name, approve, cast_at
       FROM dispute_ballots
      WHERE dispute_id = $1
      ORDER BY voter_player_id`,
    [dispute.id]
  );
  return { dispute, ballots: ballotResult.rows };
}

async function joinThroughUi(page: Page, code: string, nickname: string) {
  await page.goto(`/join/${code}`);
  await page.getByTestId('input-nickname').fill(nickname);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/rooms/${code}/join`) && response.request().method() === 'POST'
  );
  await page.getByTestId('button-join-room').click();
  return readJson<PlayerSession>(await responsePromise, `join ${nickname}`);
}

async function createThreePlayerGame(
  browser: Browser,
  request: APIRequestContext,
  testInfo: TestInfo,
  votingEnabled: boolean
): Promise<GameDriver> {
  const baseURL = String(testInfo.project.use.baseURL);
  const subnet = (process.pid + testInfo.workerIndex * 17) % 200;
  const offset = testInfo.repeatEachIndex * 6 + (votingEnabled ? 20 : 40);
  const ips: [string, string, string] = [
    `203.0.${subnet}.${offset + 1}`,
    `203.0.${subnet}.${offset + 2}`,
    `203.0.${subnet}.${offset + 3}`,
  ];
  const contexts = await Promise.all(
    ips.map((ip) => browser.newContext({ baseURL, extraHTTPHeaders: { 'X-Forwarded-For': ip } }))
  );
  await Promise.all(contexts.map(installQuestionFixture));
  const pages = (await Promise.all(contexts.map((context) => context.newPage()))) as [
    Page,
    Page,
    Page,
  ];
  const [hostPage, voterOnePage, voterTwoPage] = pages;

  try {
    await hostPage.goto('/host');
    await hostPage.getByTestId('input-nickname').fill('Host');
    const votingToggle = hostPage.getByRole('switch', { name: 'Opponent dispute voting' });
    await expect(votingToggle).toHaveAttribute('aria-checked', 'false');
    if (votingEnabled) {
      await votingToggle.click();
      await expect(votingToggle).toHaveAttribute('aria-checked', 'true');
    }

    const createResponsePromise = hostPage.waitForResponse(
      (response) => response.url().endsWith('/api/rooms') && response.request().method() === 'POST'
    );
    await hostPage.getByTestId('button-create-room').click();
    const host = await readJson<CreateRoomResponse>(await createResponsePromise, 'create room');

    const [voterOne, voterTwo] = await Promise.all([
      joinThroughUi(voterOnePage, host.code, 'Voter One'),
      joinThroughUi(voterTwoPage, host.code, 'Voter Two'),
    ]);
    await expect(hostPage.getByTestId('player-roster').getByText('Voter One')).toBeVisible();
    await expect(hostPage.getByTestId('player-roster').getByText('Voter Two')).toBeVisible();

    const startResponsePromise = hostPage.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/rooms/${host.code}/start`) &&
        response.request().method() === 'POST'
    );
    await hostPage.getByTestId('button-start-game').click();
    await readJson<RoomActionResponse>(await startResponsePromise, 'start room');
    await pinRoomToFixture(host.code);

    await expect
      .poll(
        async () => (await getSnapshot(request, host.code, host.token, ips[0])).currentQuestion?.id,
        { timeout: 10_000 }
      )
      .toBe(disputeQuestion.id);
    await Promise.all(
      pages.map((page) =>
        expect(page.getByText(disputeQuestion.question, { exact: true })).toBeVisible()
      )
    );

    return {
      contexts,
      pages,
      host,
      voters: [voterOne, voterTwo],
      ips,
      close: async () => {
        await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
      },
    };
  } catch (error) {
    await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    throw error;
  }
}

async function submitIncorrectDispute(game: GameDriver) {
  const [hostPage, voterOnePage, voterTwoPage] = game.pages;
  await hostPage.getByTestId('input-answer').fill(INCORRECT_ANSWER);
  await hostPage.getByTestId('button-submit-answer').click();
  await Promise.all(
    game.pages.map((page) => expect(page.getByTestId('text-verdict')).toHaveText('INCORRECT (-1)'))
  );

  await expect(voterOnePage.getByRole('button', { name: 'Dispute' })).toHaveCount(0);
  await expect(voterTwoPage.getByRole('button', { name: 'Dispute' })).toHaveCount(0);
  await hostPage.getByRole('button', { name: 'Dispute' }).click();
  await hostPage
    .getByPlaceholder("Explain why you think the game's answer is incorrect or provide evidence...")
    .fill(DISPUTE_EXPLANATION);
  const responsePromise = hostPage.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/rooms/${game.host.code}/disputes`) &&
      response.request().method() === 'POST'
  );
  await hostPage.getByRole('button', { name: 'Submit Dispute' }).click();
  await readJson<RoomActionResponse>(await responsePromise, 'submit dispute');
}

async function expectFinalOutcome(game: GameDriver, outcome: 'approved' | 'tied', delta: number) {
  await Promise.all(
    game.pages.flatMap((page) => [
      expect(page.getByTestId('card-dispute-outcome')).toContainText(`Dispute ${outcome}`),
      expect(page.getByTestId('card-dispute-outcome')).toContainText(
        `Final score change: ${delta > 0 ? '+' : ''}${delta}`
      ),
    ])
  );
}

test.describe('multiplayer dispute voting', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    await seedDeterministicQuestion();
  });

  test.afterAll(async () => {
    await pool.end();
  });

  test('approves by majority, recovers a locked ballot, and scores exactly once', async ({
    browser,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);
    const game = await createThreePlayerGame(browser, request, testInfo, true);
    const [hostPage, voterOnePage, voterTwoPage] = game.pages;

    try {
      await submitIncorrectDispute(game);
      await Promise.all(
        game.pages.map((page) => expect(page.getByTestId('dispute-vote-view')).toBeVisible())
      );
      await expect(hostPage.getByTestId('text-disputant-waiting')).toBeVisible();
      await expect(hostPage.getByRole('button', { name: 'Agree and award points' })).toHaveCount(0);
      await expect(hostPage.getByRole('button', { name: 'Disagree with dispute' })).toHaveCount(0);
      await expect(
        voterOnePage.getByRole('button', { name: 'Agree and award points' })
      ).toBeVisible();
      await expect(
        voterTwoPage.getByRole('button', { name: 'Agree and award points' })
      ).toBeVisible();

      const duplicateDispute = await postRoomAction(
        request,
        game.host.code,
        'disputes',
        game.host.token,
        game.ips[0],
        { explanation: DISPUTE_EXPLANATION }
      );
      expect(duplicateDispute.status()).toBe(409);

      await voterOnePage.getByRole('button', { name: 'Agree and award points' }).click();
      await expect(voterOnePage.getByTestId('text-vote-locked')).toBeVisible();
      await voterOnePage.reload();
      await expect(voterOnePage.getByTestId('text-vote-locked')).toBeVisible();
      await expect(
        voterOnePage.getByRole('button', { name: 'Agree and award points' })
      ).toHaveCount(0);

      const duplicateBallot = await postRoomAction(
        request,
        game.host.code,
        'disputes/vote',
        game.voters[0].token,
        game.ips[1],
        { approve: true }
      );
      expect(duplicateBallot.status()).toBe(409);

      await voterTwoPage.getByRole('button', { name: 'Agree and award points' }).click();
      await expectFinalOutcome(game, 'approved', 1);
      await Promise.all(
        game.pages.map((page) =>
          expect(page.getByTestId('text-verdict')).toHaveText('CORRECT (+1)')
        )
      );

      await expect
        .poll(async () => {
          const snapshots = await Promise.all([
            getSnapshot(request, game.host.code, game.host.token, game.ips[0]),
            getSnapshot(request, game.host.code, game.voters[0].token, game.ips[1]),
            getSnapshot(request, game.host.code, game.voters[1].token, game.ips[2]),
          ]);
          return snapshots.map((snapshot) => [
            snapshot.phase,
            snapshot.version,
            snapshot.currentDisputeVote?.outcome,
            snapshot.currentAttempt?.pointsDelta,
          ]);
        })
        .toEqual([
          ['REVEAL', expect.any(Number), 'approved', 1],
          ['REVEAL', expect.any(Number), 'approved', 1],
          ['REVEAL', expect.any(Number), 'approved', 1],
        ]);

      const qa = await readQaEvidence(game.host.code);
      expect(qa.dispute).toMatchObject({
        voting_enabled: true,
        threshold: 2,
        outcome: 'approved',
        original_points_delta: -1,
        final_points_delta: 1,
      });
      expect(qa.dispute.decided_at).toBeInstanceOf(Date);
      expect(qa.dispute.eligible_voter_snapshot).toEqual(
        expect.arrayContaining([
          { playerId: game.voters[0].playerId, displayName: 'Voter One' },
          { playerId: game.voters[1].playerId, displayName: 'Voter Two' },
        ])
      );
      expect(qa.ballots).toHaveLength(2);
      expect(qa.ballots.every((ballot) => ballot.approve)).toBe(true);
      expect(new Set(qa.ballots.map((ballot) => ballot.voter_player_id)).size).toBe(2);

      await hostPage.getByTestId('button-next').click();
      await expect
        .poll(async () => {
          const snapshot = await getSnapshot(request, game.host.code, game.host.token, game.ips[0]);
          return snapshot.players.find((player) => player.id === game.host.playerId)?.score;
        })
        .toBe(1);

      const duplicateAdvance = await postRoomAction(
        request,
        game.host.code,
        'advance',
        game.host.token,
        game.ips[0]
      );
      expect(duplicateAdvance.status()).toBe(409);
      const afterDuplicate = await getSnapshot(
        request,
        game.host.code,
        game.host.token,
        game.ips[0]
      );
      expect(afterDuplicate.players.find((player) => player.id === game.host.playerId)?.score).toBe(
        1
      );
    } finally {
      await game.close();
    }
  });

  test('records a tied vote, preserves the incorrect delta, and advances normally', async ({
    browser,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);
    const game = await createThreePlayerGame(browser, request, testInfo, true);

    try {
      await submitIncorrectDispute(game);
      await game.pages[1].getByRole('button', { name: 'Agree and award points' }).click();
      await expect(game.pages[1].getByTestId('text-vote-locked')).toBeVisible();
      await game.pages[2].getByRole('button', { name: 'Disagree with dispute' }).click();

      await expectFinalOutcome(game, 'tied', -1);
      await Promise.all(
        game.pages.map((page) =>
          expect(page.getByTestId('text-verdict')).toHaveText('INCORRECT (-1)')
        )
      );

      const qa = await readQaEvidence(game.host.code);
      expect(qa.dispute).toMatchObject({
        voting_enabled: true,
        threshold: 2,
        outcome: 'tied',
        original_points_delta: -1,
        final_points_delta: -1,
      });
      expect(qa.ballots.map((ballot) => ballot.approve).sort()).toEqual([false, true]);

      await game.pages[0].getByTestId('button-next').click();
      await expect
        .poll(async () => {
          const snapshot = await getSnapshot(request, game.host.code, game.host.token, game.ips[0]);
          return {
            phase: snapshot.phase,
            question: snapshot.currentQuestionIndex,
            score: snapshot.players.find((player) => player.id === game.host.playerId)?.score,
          };
        })
        .toEqual({ phase: 'QUESTION', question: 1, score: -1 });
    } finally {
      await game.close();
    }
  });

  test('defaults voting off and keeps the intentional host-only manual award', async ({
    browser,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);
    const game = await createThreePlayerGame(browser, request, testInfo, false);

    try {
      await submitIncorrectDispute(game);
      await Promise.all(
        game.pages.map(async (page) => {
          await expect(page.getByTestId('dispute-vote-view')).toHaveCount(0);
          await expect(page.getByTestId('text-dispute-submitted')).toBeVisible();
        })
      );
      await expect(
        game.pages[0].getByRole('button', { name: 'Group agreed — award points' })
      ).toBeVisible();
      await expect(
        game.pages[1].getByRole('button', { name: 'Group agreed — award points' })
      ).toHaveCount(0);
      await expect(
        game.pages[2].getByRole('button', { name: 'Group agreed — award points' })
      ).toHaveCount(0);

      const nonHostAward = await postRoomAction(
        request,
        game.host.code,
        'award-dispute',
        game.voters[0].token,
        game.ips[1]
      );
      expect(nonHostAward.status()).toBe(403);

      await game.pages[0].getByRole('button', { name: 'Group agreed — award points' }).click();
      await Promise.all(
        game.pages.map((page) =>
          expect(page.getByTestId('text-verdict')).toHaveText('CORRECT (+1)')
        )
      );

      const qa = await readQaEvidence(game.host.code);
      expect(qa.dispute).toMatchObject({
        voting_enabled: false,
        eligible_voter_snapshot: [],
        threshold: null,
        outcome: 'approved',
        original_points_delta: -1,
        final_points_delta: 1,
      });
      expect(qa.ballots).toHaveLength(0);
    } finally {
      await game.close();
    }
  });
});
