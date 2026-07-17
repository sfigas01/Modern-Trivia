import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';

const fixtureData = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/questions.json', import.meta.url)), 'utf8')
);

const HOST = 'Host';
const GUEST = 'Guest';
const HOST_ANSWER = '__ste214_host_answer__';
const GUEST_ANSWER = '__ste214_guest_answer__';
let hostIp = '198.51.100.10';
let guestIp = '198.51.100.11';

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
}

interface RoomSnapshot {
  phase: 'LOBBY' | 'QUESTION' | 'REVEAL' | 'ROUND_SCORE' | 'GAME_OVER';
  activePlayerId: string | null;
  currentQuestionIndex: number;
  players: RoomPlayer[];
}

interface RoomActionResponse {
  snapshot: RoomSnapshot;
}

async function installQuestionFixture(context: BrowserContext) {
  // Keep the browser-side question catalog deterministic, matching smoke.spec.ts.
  // Room endpoints are intentionally not intercepted: multiplayer state and
  // transitions must always exercise the production server.
  await context.route('**/api/questions**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixtureData),
      });
    } else {
      await route.continue();
    }
  });

  await context.route('**/api/questions/seen', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function readJson<T>(
  response: Awaited<ReturnType<APIRequestContext['post']>>,
  label: string
) {
  const body = await response.text();
  expect(response.ok(), `${label} failed (${response.status()}): ${body}`).toBeTruthy();
  return JSON.parse(body) as T;
}

async function postRoomAction(
  request: APIRequestContext,
  code: string,
  action: 'answer' | 'advance' | 'continue',
  token: string,
  data: Record<string, unknown> = {},
  clientIp = hostIp
) {
  const response = await request.post(`/api/rooms/${code}/${action}`, {
    headers: { 'X-Player-Token': token, 'X-Forwarded-For': clientIp },
    data,
  });
  return readJson<RoomActionResponse>(response, `POST /api/rooms/${code}/${action}`);
}

async function getSnapshot(
  request: APIRequestContext,
  code: string,
  token: string,
  clientIp = hostIp
) {
  const response = await request.get(`/api/rooms/${code}`, {
    headers: { 'X-Player-Token': token, 'X-Forwarded-For': clientIp },
  });
  const body = await response.text();
  expect(
    response.ok(),
    `GET /api/rooms/${code} failed (${response.status()}): ${body}`
  ).toBeTruthy();
  return JSON.parse(body) as RoomSnapshot;
}

async function joinRoom(request: APIRequestContext, code: string, nickname: string) {
  const response = await request.post(`/api/rooms/${code}/join`, { data: { nickname } });
  return readJson<PlayerSession>(response, `join ${nickname}`);
}

async function createRoom(request: APIRequestContext, nickname: string) {
  const response = await request.post('/api/rooms', {
    data: { nickname, categories: ['All'], numRounds: 5 },
  });
  return readJson<CreateRoomResponse>(response, `create room for ${nickname}`);
}

async function playUntilPhase(
  request: APIRequestContext,
  code: string,
  hostToken: string,
  driversByPlayerId: Map<string, { token: string; clientIp: string }>,
  targetPhase: 'ROUND_SCORE' | 'GAME_OVER'
) {
  let snapshot = await getSnapshot(request, code, hostToken);

  for (let transition = 0; transition < 250; transition += 1) {
    if (snapshot.phase === targetPhase || snapshot.phase === 'GAME_OVER') return snapshot;

    if (snapshot.phase === 'QUESTION') {
      const activeDriver = snapshot.activePlayerId
        ? driversByPlayerId.get(snapshot.activePlayerId)
        : undefined;
      expect(
        activeDriver,
        `missing token for active player ${snapshot.activePlayerId}`
      ).toBeTruthy();
      snapshot = (
        await postRoomAction(
          request,
          code,
          'answer',
          activeDriver!.token,
          { answer: null },
          activeDriver!.clientIp
        )
      ).snapshot;
    } else if (snapshot.phase === 'REVEAL') {
      const activeDriver = snapshot.activePlayerId
        ? driversByPlayerId.get(snapshot.activePlayerId)
        : undefined;
      expect(
        activeDriver,
        `missing token for active player ${snapshot.activePlayerId}`
      ).toBeTruthy();
      snapshot = (
        await postRoomAction(
          request,
          code,
          'advance',
          activeDriver!.token,
          {},
          activeDriver!.clientIp
        )
      ).snapshot;
    } else if (snapshot.phase === 'ROUND_SCORE') {
      snapshot = (await postRoomAction(request, code, 'continue', hostToken)).snapshot;
    }
  }

  throw new Error(`Room ${code} did not reach ${targetPhase}`);
}

function normalizedFinalRanking(page: Page) {
  return page
    .locator('[data-testid^="final-result-row-"]')
    .allTextContents()
    .then((rows) =>
      rows.map((row) =>
        row
          .replace(/\s*\(you\)/, '')
          .replace(/\s+/g, ' ')
          .trim()
      )
    );
}

test.describe('two-device multiplayer', () => {
  test('host setup offers opponent dispute voting off by default', async ({ page }) => {
    await installQuestionFixture(page.context());
    await page.goto('/host');

    const toggle = page.getByRole('switch', { name: 'Opponent dispute voting' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(
      page.getByText(
        'Opposing players vote on disputed incorrect answers; majority approval awards normal points.'
      )
    ).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  test('host and guest complete a synchronized full game', async ({
    browser,
    request,
  }, testInfo) => {
    test.setTimeout(180_000);

    const subnet = (process.pid % 200) + 1;
    hostIp = `198.51.${subnet}.${10 + testInfo.repeatEachIndex * 2}`;
    guestIp = `198.51.${subnet}.${11 + testInfo.repeatEachIndex * 2}`;
    const baseURL = String(testInfo.project.use.baseURL);

    // Manually-created contexts do not inherit the project's baseURL option.
    const hostContext = await browser.newContext({
      baseURL,
      extraHTTPHeaders: { 'X-Forwarded-For': hostIp },
    });
    const guestContext = await browser.newContext({
      baseURL,
      extraHTTPHeaders: { 'X-Forwarded-For': guestIp },
    });
    await installQuestionFixture(hostContext);
    await installQuestionFixture(guestContext);

    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    try {
      await hostPage.goto('/host');
      await hostPage.getByTestId('input-nickname').fill(HOST);
      await hostPage.getByRole('button', { name: '5', exact: true }).click();

      const createResponsePromise = hostPage.waitForResponse(
        (response) =>
          response.url().endsWith('/api/rooms') && response.request().method() === 'POST'
      );
      await hostPage.getByTestId('button-create-room').click();
      const createResponse = await createResponsePromise;
      const host = await readJson<CreateRoomResponse>(createResponse, 'create room');

      await expect(hostPage).toHaveURL(new RegExp(`/room/${host.code}$`));
      await expect(hostPage.getByTestId('text-room-code')).toHaveText(host.code);

      await guestPage.goto(`/join/${host.code}`);
      await guestPage.getByTestId('input-nickname').fill(GUEST);
      const joinResponsePromise = guestPage.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/rooms/${host.code}/join`) &&
          response.request().method() === 'POST'
      );
      await guestPage.getByTestId('button-join-room').click();
      const joinResponse = await joinResponsePromise;
      const guest = await readJson<PlayerSession>(joinResponse, 'guest join');

      await expect(guestPage).toHaveURL(new RegExp(`/room/${host.code}$`));
      await expect(
        hostPage.getByTestId('player-roster').getByText(GUEST, { exact: true })
      ).toBeVisible();

      const duplicateResponse = await request.post(`/api/rooms/${host.code}/join`, {
        data: { nickname: GUEST.toLowerCase() },
      });
      expect(duplicateResponse.status()).toBe(409);
      await expect(duplicateResponse.json()).resolves.toMatchObject({
        message: 'Nickname is already taken',
      });

      // Verify capacity against a separate real-server room so the primary
      // two-device game remains a practical 40 questions instead of expanding
      // to 80 merely to exercise the join guard.
      const capacityRoom = await createRoom(request, 'CapacityHost');
      await joinRoom(request, capacityRoom.code, 'CapacityTwo');
      await joinRoom(request, capacityRoom.code, 'CapacityThree');
      await joinRoom(request, capacityRoom.code, 'CapacityFour');
      const fifthResponse = await request.post(`/api/rooms/${capacityRoom.code}/join`, {
        data: { nickname: 'Fifth' },
      });
      expect(fifthResponse.status()).toBe(409);
      await expect(fifthResponse.json()).resolves.toMatchObject({ message: 'Room is full' });

      const driversByPlayerId = new Map([
        [host.playerId, { token: host.token, clientIp: hostIp }],
        [guest.playerId, { token: guest.token, clientIp: guestIp }],
      ]);

      await expect(hostPage.getByTestId('button-start-game')).toBeEnabled();
      await hostPage.getByTestId('button-start-game').click();

      await expect(hostPage.getByTestId('badge-your-turn')).toBeVisible();
      await expect(hostPage.getByTestId('input-answer')).toBeVisible();
      await expect(guestPage.getByTestId('text-waiting-turn')).toContainText(`Waiting for ${HOST}`);
      await expect(guestPage.getByTestId('input-answer')).toHaveCount(0);

      await hostPage.getByTestId('input-answer').fill(HOST_ANSWER);
      await hostPage.getByTestId('button-submit-answer').click();

      await expect(hostPage.getByTestId('card-attempt-verdict')).toContainText(HOST_ANSWER);
      await expect(guestPage.getByTestId('card-attempt-verdict')).toContainText(HOST_ANSWER);
      await expect(hostPage.getByText('Correct Answer', { exact: true })).toBeVisible();
      await expect(guestPage.getByText('Correct Answer', { exact: true })).toBeVisible();

      await hostPage.getByTestId('button-next').click();
      await expect(hostPage.getByTestId('input-answer')).toBeVisible();

      // A turn is four questions. Complete the host's remaining three, then
      // verify the advancing transition hands control to the guest.
      for (let hostQuestion = 2; hostQuestion <= 4; hostQuestion += 1) {
        await postRoomAction(request, host.code, 'answer', host.token, { answer: null }, hostIp);
        await postRoomAction(request, host.code, 'advance', host.token);
      }

      await expect(guestPage.getByTestId('badge-your-turn')).toBeVisible();
      await expect(hostPage.getByTestId('text-waiting-turn')).toContainText(`Waiting for ${GUEST}`);
      await expect(hostPage.getByTestId('input-answer')).toHaveCount(0);

      // Refresh during QUESTION. The guest's stored token must silently restore
      // the active-player view without visiting the join screen again.
      await guestPage.reload();
      await expect(guestPage).toHaveURL(new RegExp(`/room/${host.code}$`));
      await expect(guestPage.getByTestId('badge-your-turn')).toBeVisible();
      await expect(guestPage.getByTestId('input-answer')).toBeVisible();
      await expect(hostPage.getByTestId('input-answer')).toHaveCount(0);

      await guestPage.getByTestId('input-answer').fill(GUEST_ANSWER);
      await guestPage.getByTestId('button-submit-answer').click();
      await expect(guestPage.getByTestId('card-attempt-verdict')).toContainText(GUEST_ANSWER);
      await expect(hostPage.getByTestId('card-attempt-verdict')).toContainText(GUEST_ANSWER);
      await guestPage.getByTestId('button-next').click();

      const firstRound = await playUntilPhase(
        request,
        host.code,
        host.token,
        driversByPlayerId,
        'ROUND_SCORE'
      );
      expect(firstRound.phase).toBe('ROUND_SCORE');
      await expect(hostPage.getByText('Round Scores', { exact: true })).toBeVisible();
      await expect(guestPage.getByText('Round Scores', { exact: true })).toBeVisible();
      await expect(hostPage.getByTestId('button-next-round')).toBeVisible();
      await expect(guestPage.getByTestId('text-waiting-host-round')).toBeVisible();

      await hostPage.getByTestId('button-next-round').click();
      await expect(hostPage.getByTestId('badge-your-turn')).toBeVisible();

      const gameOver = await playUntilPhase(
        request,
        host.code,
        host.token,
        driversByPlayerId,
        'GAME_OVER'
      );
      expect(gameOver.phase).toBe('GAME_OVER');

      await expect(hostPage.getByText('Final Results', { exact: true })).toBeVisible({
        timeout: 10_000,
      });
      await expect(guestPage.getByText('Final Results', { exact: true })).toBeVisible({
        timeout: 10_000,
      });
      await expect
        .poll(
          async () => {
            const [hostRanking, guestRanking] = await Promise.all([
              normalizedFinalRanking(hostPage),
              normalizedFinalRanking(guestPage),
            ]);
            return (
              hostRanking.length === 2 &&
              JSON.stringify(hostRanking) === JSON.stringify(guestRanking)
            );
          },
          { timeout: 10_000 }
        )
        .toBe(true);
    } finally {
      await Promise.all([
        hostContext.close().catch(() => undefined),
        guestContext.close().catch(() => undefined),
      ]);
    }
  });
});
