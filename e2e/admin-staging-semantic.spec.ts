import { expect, test } from '@playwright/test';

test('reports duplicates, answer conflicts and uncertain reviews separately after generation', async ({
  page,
}) => {
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({ json: { id: 'admin-user', email: 'admin@example.com' } })
  );
  await page.route('**/api/admin/check', (route) => route.fulfill({ json: { isAdmin: true } }));
  await page.route('**/api/questions**', (route) =>
    route.fulfill({ json: { categories: [], questions: [] } })
  );
  await page.route('**/api/staging', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/staging/generate', (route) =>
    route.fulfill({
      status: 201,
      json: {
        count: 1,
        droppedAsDuplicate: 2,
        droppedAsConflict: 2,
        droppedForReview: 1,
        questions: [],
      },
    })
  );
  await page.goto('/admin/staging');
  await page.getByTestId('input-generate-topic').fill('Synthetic test topic');
  await page.getByTestId('button-generate-questions').click();
  await expect(
    page
      .getByText(
        '1 question added to the review queue (2 dropped as duplicates). 2 withheld for conflicting answers; 1 withheld because semantic review was uncertain.',
        { exact: true }
      )
      .first()
  ).toBeVisible();
});
