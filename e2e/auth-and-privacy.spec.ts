import { test, expect } from '@playwright/test';

// The Google OAuth consent screen links to /privacy, so it must render for
// signed-out visitors. The server must also answer its Railway healthcheck.
test.describe('privacy policy and health endpoints', () => {
  test('/privacy renders without signing in', async ({ page }) => {
    await page.goto('/privacy');

    await expect(page.getByRole('heading', { name: 'Privacy policy' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'When you sign in with Google' })).toBeVisible();
    await page.getByRole('link', { name: 'Back to the game' }).click();
    await expect(page).toHaveURL('/');
  });

  test('/health reports the database as ok', async ({ request }) => {
    const res = await request.get('/health');

    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', database: 'ok' });
  });

  test('/api/login answers 503 when Google sign-in is not configured', async ({ request }) => {
    // CI runs without Google credentials; sign-in must fail loudly, not crash.
    const res = await request.get('/api/login', { maxRedirects: 0 });

    expect(res.status()).toBe(503);
  });
});
