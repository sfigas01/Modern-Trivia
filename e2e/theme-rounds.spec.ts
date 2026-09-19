import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, type BrowserContext } from '@playwright/test';

// Themed games E2E (STE-167 lean MVP).
//
// Unlike the multiplayer spec, the themed flow's question sourcing calls the
// Guardian pipeline (OpenAI), which cannot run in CI. So this spec intercepts
// the theme + room endpoints to drive the themed-specific UX deterministically:
// theme entry → suggested categories → lobby → "generating… X of N ready"
// progress → transition into the game. The generation itself is covered by the
// server unit/integration tests.

const fixtureData = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/questions.json', import.meta.url)), 'utf8')
);

const CODE = 'ABCD2';
const HOST_ID = '11111111-1111-4111-8111-111111111111';
const GUEST_ID = '22222222-2222-4222-8222-222222222222';

function lobbySnapshot() {
  return {
    id: 'room-1',
    code: CODE,
    status: 'lobby',
    phase: 'LOBBY',
    version: 1,
    hostPlayerId: HOST_ID,
    categories: ['Sports'],
    theme: 'baseball',
    numRounds: 5,
    currentQuestionIndex: 0,
    activePlayerId: null,
    currentAttempt: null,
    opponentDisputeVotingEnabled: false,
    activeDisputeId: null,
    currentDisputeVote: null,
    currentQuestion: null,
    players: [player(HOST_ID, 'Host', true, 0), player(GUEST_ID, 'Guest', false, 1)],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  };
}

function questionSnapshot() {
  return {
    ...lobbySnapshot(),
    status: 'active',
    phase: 'QUESTION',
    version: 2,
    activePlayerId: HOST_ID,
    currentQuestion: {
      id: 'gen-1',
      category: 'Sports',
      difficulty: 'Medium',
      question: 'Which team won the very first World Series in 1903?',
      pillar: 'GlobalEh',
      tags: ['theme:baseball', 'Sports'],
      sourceUrl: null,
      sourceName: null,
    },
  };
}

function player(id: string, nickname: string, isHost: boolean, joinOrder: number) {
  return {
    id,
    nickname,
    joinOrder,
    score: 0,
    questionCount: 0,
    lastRoundDelta: 0,
    isHost,
    presence: 'online' as const,
    lastSeenAt: new Date().toISOString(),
    leftAt: null,
  };
}

async function installThemeFixtures(
  context: BrowserContext,
  state: { phase: 'LOBBY' | 'QUESTION' }
) {
  // Deterministic question catalog for the host setup screen.
  await context.route('**/api/questions**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixtureData),
      });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
  });

  await context.route('**/api/theme/suggest', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ theme: 'baseball', categories: ['Sports'] }),
    });
  });

  await context.route('**/api/rooms', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ code: CODE, playerId: HOST_ID, token: 'host-token' }),
    });
  });

  let progressPolls = 0;
  await context.route(`**/api/rooms/${CODE}/theme-start`, async (route) => {
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'preparing',
        ready: 0,
        total: 40,
        reused: 0,
        generated: 0,
        error: null,
      }),
    });
  });

  await context.route(`**/api/rooms/${CODE}/theme-progress`, async (route) => {
    progressPolls += 1;
    if (progressPolls >= 2) {
      // Preparation complete: flip the room snapshot to QUESTION so the room
      // poll transitions the client into the game.
      state.phase = 'QUESTION';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ready',
          ready: 40,
          total: 40,
          reused: 16,
          generated: 24,
          error: null,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'preparing',
        ready: 12,
        total: 40,
        reused: 8,
        generated: 4,
        error: null,
      }),
    });
  });

  // Room snapshot poll — serves LOBBY until preparation flips it to QUESTION.
  await context.route(`**/api/rooms/${CODE}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.phase === 'QUESTION' ? questionSnapshot() : lobbySnapshot()),
    });
  });
}

test.describe('Themed games (VITE_THEME_ROUNDS)', () => {
  test('host sets a theme, adjusts suggested categories, and plays after a short wait', async ({
    page,
    context,
  }) => {
    const state: { phase: 'LOBBY' | 'QUESTION' } = { phase: 'LOBBY' };
    await installThemeFixtures(context, state);

    // ── Setup: enter theme, get suggested categories ────────────────────────
    await page.goto('/host');
    await expect(page.getByTestId('input-theme')).toBeVisible();

    await page.getByTestId('input-theme').fill('baseball');
    await page.getByTestId('button-suggest-categories').click();

    await page.getByTestId('input-nickname').fill('Host');
    await page.getByTestId('button-create-room').click();

    // ── Lobby: themed room shows the theme and a themed start button ────────
    await page.waitForURL(`**/room/${CODE}`);
    await expect(page.getByTestId('button-start-themed-game')).toBeVisible();

    await page.getByTestId('button-start-themed-game').click();

    // ── Waiting UX: "generating… X of N ready" ──────────────────────────────
    await expect(page.getByTestId('text-theme-progress')).toContainText('of 40 ready', {
      timeout: 15000,
    });

    // ── Transition into the game once preparation completes ─────────────────
    await expect(page.getByText('Which team won the very first World Series in 1903?')).toBeVisible(
      { timeout: 15000 }
    );
  });
});
