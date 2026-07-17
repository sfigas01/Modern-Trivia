import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const fixtureData = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/questions.json', import.meta.url)), 'utf8')
);

const WRONG_ANSWER = 'definitely wrong answer';
const CORRECT_ANSWER = 'H2O'; // smoke-q1 correct answer
const EXPECTED_POINTS_DELTA = -1; // Easy wrong answer

test.describe('SETUP → QUESTION → REVEAL loop', () => {
  test.beforeEach(async ({ page }) => {
    // Guest question selection shuffles locally-unseen questions; keep this
    // order-sensitive smoke path deterministic so smoke-q1 is selected first.
    await page.addInitScript(() => {
      Math.random = () => 0.5;
    });

    // Intercept both the initial catalog load and startGame shuffle request
    await page.route('**/api/questions**', async (route) => {
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

    // Intercept the seen-questions POST (fired on GAME_OVER)
    await page.route('**/api/questions/seen', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
  });

  test('happy path: wrong answer decrements team score by expected delta', async ({ page }) => {
    // ── 1. SETUP phase ──────────────────────────────────────────────────────
    await page.goto('/');

    // Assert SETUP UI is visible
    await expect(page.getByRole('heading', { name: 'TRIVIA' })).toBeVisible();
    const playSoloButton = page.getByRole('button', { name: 'Play Solo' });
    await playSoloButton.click();
    await expect(page.getByText('Team Setup')).toBeVisible();

    // Add TeamA
    const teamInput = page.getByPlaceholder('Enter team name...');
    await teamInput.fill('TeamA');
    await teamInput.press('Enter');
    await expect(page.getByText('TeamA')).toBeVisible();

    // Add TeamB
    await teamInput.fill('TeamB');
    await teamInput.press('Enter');
    await expect(page.getByText('TeamB')).toBeVisible();

    // Select a category — wait for categories to load from the intercepted API
    await expect(page.getByRole('button', { name: /Science/ })).toBeVisible();
    await page.getByRole('button', { name: /Science/ }).click();

    // Start the game
    await page.getByTestId('button-start-game').click();
    await page.waitForURL('**/game');

    // ── 2. QUESTION phase ───────────────────────────────────────────────────
    const answerInput = page.getByPlaceholder('Type answer here...');
    await expect(answerInput).toBeVisible();

    // Assert TeamA is the *active* team — the "Active Team" label in the
    // question-phase header is only rendered for the current player, unlike
    // the scoreboard strip which always lists all teams. Anchoring to this
    // label means a rotation bug (wrong team shown as active) would fail here.
    await expect(page.getByText('Active Team', { exact: true }).locator('..')).toContainText(
      'TeamA'
    );

    // ── 3. Submit a known-wrong answer ──────────────────────────────────────
    await answerInput.fill(WRONG_ANSWER);
    await page.getByRole('button', { name: 'Submit Answer' }).click();

    // ── 4. REVEAL phase ─────────────────────────────────────────────────────
    // "They Answered" card shows the wrong submitted answer
    await expect(page.getByText('They Answered')).toBeVisible();
    await expect(page.getByText(WRONG_ANSWER)).toBeVisible();

    // "Correct Answer" card shows the right answer
    await expect(page.getByText('Correct Answer')).toBeVisible();
    await expect(page.getByText(CORRECT_ANSWER)).toBeVisible();

    // Verdict + points delta
    const expectedVerdictText = `INCORRECT (${EXPECTED_POINTS_DELTA})`;
    await expect(page.getByText(expectedVerdictText)).toBeVisible();

    // ── 5. Advance to SCORE_UPDATE → QUESTION ───────────────────────────────
    await page.getByRole('button', { name: /NEXT QUESTION/i }).click();

    // Should now be in the next QUESTION phase — answer input re-appears
    await expect(page.getByPlaceholder('Type answer here...')).toBeVisible();

    // ── 6. Assert TeamA score decreased by expected delta ───────────────────
    // Scoreboard strip at the bottom of the game screen renders each team as:
    //   <span class="font-bold">{name}</span>
    //   <span class="font-mono ...">{score}</span>
    // Locate TeamA's score span via its sibling relationship.
    const teamAScore = page
      .locator('span.font-bold:text-is("TeamA")')
      .locator('..')
      .locator('span.font-mono');

    await expect(teamAScore).toHaveText(String(EXPECTED_POINTS_DELTA));
  });
});

test.describe('admin dispute audit', () => {
  test('shows multiplayer vote evidence separately from QA status on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'admin-user', email: 'admin@example.com' }),
      })
    );
    await page.route('**/api/admin/check', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ isAdmin: true }),
      })
    );
    await page.route('**/api/questions**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixtureData),
      })
    );
    await page.route('**/api/disputes', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'audit-dispute',
            questionId: 'smoke-q1',
            questionText: 'What is the chemical formula for water?',
            correctAnswer: 'H2O',
            teamName: 'Alpha',
            submittedAnswer: 'Water',
            teamExplanation: 'The plain-language answer should count.',
            timestamp: '2026-07-14T12:00:00.000Z',
            status: 'pending',
            resolutionNote: null,
            aiAnalysis: null,
            roomId: '33333333-3333-4333-8333-333333333333',
            roomCode: 'ABCD2',
            attemptKey: '33333333-3333-4333-8333-333333333333:0',
            disputingPlayerId: '44444444-4444-4444-8444-444444444444',
            disputingPlayerName: 'Alpha',
            votingEnabled: true,
            eligibleVoterSnapshot: [
              { playerId: '11111111-1111-4111-8111-111111111111', displayName: 'Bravo' },
              { playerId: '22222222-2222-4222-8222-222222222222', displayName: 'Charlie' },
            ],
            threshold: 2,
            outcome: 'approved',
            originalPointsDelta: -1,
            finalPointsDelta: 1,
            decidedAt: '2026-07-14T12:01:00.000Z',
            ballots: [
              {
                id: 'ballot-1',
                disputeId: 'audit-dispute',
                voterPlayerId: '11111111-1111-4111-8111-111111111111',
                voterPlayerName: 'Bravo',
                approve: true,
                castAt: '2026-07-14T12:00:30.000Z',
              },
            ],
          },
        ]),
      })
    );

    await page.goto('/admin/disputes');

    const audit = page.getByTestId('vote-audit-audit-dispute');
    await expect(audit.getByText('Gameplay decision audit')).toBeVisible();
    await expect(audit.getByText('approved')).toBeVisible();
    await expect(audit.getByText('pending')).toBeVisible();
    await expect(audit.getByText('1 yes / 0 no / 1 no response')).toBeVisible();
    await expect(audit.getByText('-1 → +1')).toBeVisible();

    await page.getByText('Ballot details (1/2 responded)').click();
    await expect(
      page.getByTestId('ballot-row-11111111-1111-4111-8111-111111111111').getByText('Agree')
    ).toBeVisible();
    await expect(
      page.getByTestId('ballot-row-22222222-2222-4222-8222-222222222222').getByText('No response')
    ).toBeVisible();
  });
});
