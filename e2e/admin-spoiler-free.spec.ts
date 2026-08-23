import { expect, test, type Page } from '@playwright/test';

// STE-248: the admin is also a player, so no admin surface may show an answer
// without an explicit reveal click.

const QUESTION_ANSWER = 'Zzntinople';
const DISPUTE_ANSWER = 'Qwybarium';
const DISPUTE_CLAIM = 'Frobnaxus';

async function mockAdminAuth(page: Page) {
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
}

test.describe('spoiler-free admin surfaces (STE-248)', () => {
  test('admin questions: answer is masked until revealed', async ({ page }) => {
    const question = {
      id: 'spoiler-q1',
      category: 'Culture',
      difficulty: 'Easy',
      question: 'Which ancient city is referenced here?',
      answer: QUESTION_ANSWER,
      acceptableAnswers: [],
      explanation: 'An explanation that does not contain the answer.',
      pillar: 'GlobalEh',
      tags: ['Culture', 'GlobalEh'],
      sourceUrl: 'https://example.com/x',
      sourceName: 'Source',
      status: 'approved',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      aiAnalysis: null,
    };

    await mockAdminAuth(page);
    await page.route('**/api/admin/questions**', (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          questions: [question],
          total: 1,
          categories: [question.category],
          pillars: [question.pillar],
        }),
      });
    });

    await page.goto('/admin/questions');

    // Row is collapsed on load — the answer must not be in the DOM at all.
    await expect(page.getByTestId(`row-question-${question.id}`)).toBeVisible();
    await expect(page.getByText(QUESTION_ANSWER, { exact: false })).toHaveCount(0);

    // Expanding the row still must not spoil the answer.
    await page.getByTestId(`row-question-${question.id}`).click();
    await expect(page.getByTestId(`masked-answer-answer-${question.id}`)).toBeVisible();
    await expect(page.getByText(QUESTION_ANSWER, { exact: false })).toHaveCount(0);

    // Explicit reveal shows it.
    await page.getByTestId(`button-toggle-answer-answer-${question.id}`).click();
    await expect(page.getByTestId(`text-answer-answer-${question.id}`)).toHaveText(QUESTION_ANSWER);
  });

  test('admin disputes: current answer is masked until revealed', async ({ page }) => {
    const dispute = {
      id: 'spoiler-d1',
      questionId: 'q-underlying',
      questionText: 'What is the disputed question?',
      correctAnswer: DISPUTE_ANSWER,
      submittedAnswer: DISPUTE_CLAIM,
      teamName: 'Team One',
      teamExplanation: 'We think our answer is right.',
      status: 'pending',
      timestamp: '2026-07-01T00:00:00.000Z',
      aiAnalysis: null,
    };

    await mockAdminAuth(page);
    await page.route('**/api/disputes', (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([dispute]),
      });
    });

    await page.goto('/admin/disputes');

    // The dispute card renders on load, but neither the correct answer nor the
    // user's claim (which is often the real answer) may be visible.
    await expect(page.getByText(dispute.questionText).first()).toBeVisible();
    await expect(page.getByText(DISPUTE_ANSWER, { exact: false })).toHaveCount(0);
    await expect(page.getByText(DISPUTE_CLAIM, { exact: false })).toHaveCount(0);

    // Explicit reveal shows the current answer.
    await page.getByTestId(`button-toggle-answer-dispute-correct-${dispute.id}`).click();
    await expect(page.getByTestId(`text-answer-dispute-correct-${dispute.id}`)).toHaveText(
      DISPUTE_ANSWER
    );
  });
});
