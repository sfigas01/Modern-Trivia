import { test, expect } from '@playwright/test';
import fixtureData from './fixtures/questions.json';

const WRONG_ANSWER = 'definitely wrong answer';
const CORRECT_ANSWER = 'H2O'; // smoke-q1 correct answer
const EXPECTED_POINTS_DELTA = -1; // Easy wrong answer

test.describe('SETUP → QUESTION → REVEAL loop', () => {
  test.beforeEach(async ({ page }) => {
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

    // Assert TeamA is the active team shown in the header area
    await expect(page.getByText('TeamA').first()).toBeVisible();

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
