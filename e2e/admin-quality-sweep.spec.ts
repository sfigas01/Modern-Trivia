import { expect, test } from '@playwright/test';

const question = {
  id: 'quality-q1',
  category: 'Culture',
  difficulty: 'Easy',
  question: 'Which city hosts the festival?',
  answer: 'Toronto',
  acceptableAnswers: ['Toronto, Ontario'],
  explanation: 'The festival is held in Toronto.',
  pillar: 'GlobalEh',
  tags: ['CA', 'Culture', 'GlobalEh'],
  sourceUrl: 'https://example.com/festival',
  sourceName: 'Festival source',
  status: 'approved',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  aiAnalysis: { verdict: 'pass' },
};

const report = {
  generatedAt: '2026-07-16T12:00:00.000Z',
  totalQuestions: 1,
  audit: {
    generatedAt: '2026-07-16T12:00:00.000Z',
    totalQuestions: 1,
    totalFindings: 1,
    flaggedQuestionCount: 1,
    findingsBySeverity: { high: 0, medium: 1, low: 0 },
    findingsByRule: { subjective_prompt: 1 },
    findings: [
      {
        questionId: question.id,
        questionIndex: 0,
        severity: 'medium',
        rule: 'subjective_prompt',
        message: 'Rewrite the subjective wording.',
      },
    ],
  },
  duplicates: null,
  factCheck: null,
  recommendations: [],
  questionsById: {
    [question.id]: {
      question: question.question,
      answer: question.answer,
      tags: question.tags,
      category: question.category,
      pillar: question.pillar,
      hasSource: true,
      difficulty: question.difficulty,
      sourceDomain: 'example.com',
    },
  },
};

test.describe('admin quality-sweep editing', () => {
  test('persists a manual edit with only the intended PATCH fields', async ({ page }) => {
    let patchBody: unknown;

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
    await page.route('**/api/admin/quality-sweep', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(report),
      })
    );
    await page.route('**/api/questions**', async (route) => {
      if (route.request().method() === 'PATCH') {
        patchBody = route.request().postDataJSON();
        const requestedPatch = patchBody as Record<string, unknown>;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...question,
            ...requestedPatch,
            answer: 'Toronto, Ontario (saved)',
            updatedAt: '2026-07-16T12:05:00.000Z',
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ questions: [question], categories: [question.category] }),
      });
    });

    await page.goto('/admin/quality-sweep');
    await page.getByRole('button', { name: 'Run Quality Sweep' }).click();
    await expect(page.getByText('Rewrite the subjective wording.')).toBeVisible();

    await page.getByTestId(`button-edit-${question.id}`).click();
    await page.getByTestId(`edit-question-${question.id}`).fill('Which Canadian city hosts it?');
    await page.getByTestId(`edit-answer-${question.id}`).fill('Toronto, Ontario');
    await page
      .getByTestId(`edit-explanation-${question.id}`)
      .fill('The festival is held in Toronto, Ontario.');
    await page.getByTestId(`save-${question.id}`).click();

    await expect
      .poll(() => patchBody)
      .toEqual({
        question: 'Which Canadian city hosts it?',
        answer: 'Toronto, Ontario',
        explanation: 'The festival is held in Toronto, Ontario.',
      });
    await expect(page.getByText('The fix has been saved.', { exact: true })).toBeVisible();
  });
});

const obviousQuestion = {
  id: 'quality-q2',
  category: 'Sports',
  difficulty: 'Easy',
  question: 'Which NHL team is known as the Maple Leafs?',
  answer: 'Toronto',
  acceptableAnswers: [],
  explanation: "The Maple Leafs are Toronto's National Hockey League franchise.",
  pillar: 'TimeCapsule',
  tags: ['CA', 'TimeCapsule', 'Sports'],
  sourceUrl: 'https://example.com/maple-leafs',
  sourceName: 'Leafs source',
  status: 'approved',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  aiAnalysis: { verdict: 'pass' },
};

const obviousnessResult = {
  questionId: obviousQuestion.id,
  verdict: 'fail',
  coherence: 'pass',
  obviousness: 'fail',
  confidence: 92,
  reason: 'The nickname "Maple Leafs" hands over the city without any hockey knowledge.',
  suggestedQuestion: 'In what year did the Toronto Maple Leafs win their first Stanley Cup?',
  suggestedDifficulty: 'Medium',
};

const obviousnessReport = {
  generatedAt: '2026-07-16T12:00:00.000Z',
  totalQuestions: 1,
  audit: {
    generatedAt: '2026-07-16T12:00:00.000Z',
    totalQuestions: 1,
    totalFindings: 0,
    flaggedQuestionCount: 0,
    findingsBySeverity: { high: 0, medium: 0, low: 0 },
    findingsByRule: {},
    findings: [],
  },
  duplicates: null,
  factCheck: {
    totalChecked: 1,
    results: [obviousnessResult],
  },
  recommendations: [],
  questionsById: {
    [obviousQuestion.id]: {
      question: obviousQuestion.question,
      answer: obviousQuestion.answer,
      tags: obviousQuestion.tags,
      category: obviousQuestion.category,
      pillar: obviousQuestion.pillar,
      hasSource: true,
      difficulty: obviousQuestion.difficulty,
      sourceDomain: 'example.com',
    },
  },
};

test.describe('admin quality-sweep obviousness findings', () => {
  test('surfaces an obviousness failure with its suggested rewrite and difficulty', async ({
    page,
  }) => {
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
    await page.route('**/api/admin/quality-sweep', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(obviousnessReport),
      })
    );
    await page.route('**/api/questions**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          questions: [obviousQuestion],
          categories: [obviousQuestion.category],
        }),
      })
    );

    await page.goto('/admin/quality-sweep');
    await page.getByRole('button', { name: 'Run Quality Sweep' }).click();

    await expect(page.getByText('obvious', { exact: true })).toBeVisible();
    await expect(page.getByText(obviousnessResult.reason)).toBeVisible();
    await expect(
      page.getByText('Suggested rewrite (tests real knowledge instead of the giveaway)')
    ).toBeVisible();
    await expect(page.getByText(obviousnessResult.suggestedQuestion)).toBeVisible();
    await expect(page.getByText('Suggested difficulty')).toBeVisible();
    await expect(page.getByText('Easy → Medium')).toBeVisible();
  });
});
