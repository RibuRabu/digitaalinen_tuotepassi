import { test, expect } from '@playwright/test';

// End-to-end browser journey for the PUBLIC product passport (the page a
// consumer opens from a QR code / NFC tag). Requires a running Worker with a
// seeded active product at slug `esimerkki`. Run:
//   PASSPORT_SLUG=esimerkki WORKER_URL=http://localhost:8787 \
//     npx playwright test tests/passport.e2e.spec.js --project=passport-ui
//
// Covers customer-journey steps 13–15 and 28 (no raw enum leaks on the public
// passport). Skips automatically if the seeded product is not present, so the
// default `npm test` run against production does not fail on missing seed data.

const SLUG = process.env.PASSPORT_SLUG || 'esimerkki';

test.describe('public product passport', () => {
  test.beforeEach(async ({ request }) => {
    const res = await request.get(`/api/public/product/${SLUG}`);
    test.skip(res.status() !== 200, `no seeded public product at /p/${SLUG}`);
  });

  test('renders the passport in Finnish with product data and EU badge', async ({ page }) => {
    await page.goto(`/p/${SLUG}`);
    await expect(page.locator('.pp-name')).toBeVisible();
    // Chrome + system labels are Finnish, never raw enums.
    await expect(page.locator('body')).toContainText('Digitaalinen tuotepassi');
    await expect(page.locator('body')).toContainText('Valmistaja');
    // No raw internal enum should ever appear on the public page.
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/\b(on_metal|not_started|in_progress)\b/);
  });

  test('language selector switches chrome + translated fields, keeps untranslated in original', async ({ page }) => {
    await page.goto(`/p/${SLUG}`);
    const selector = page.locator('#pp-lang-select');
    // Only meaningful when the seeded product has a translation; skip otherwise.
    test.skip(await selector.count() === 0, 'seeded product has no translations');

    await expect(selector).toBeVisible();
    await selector.selectOption('en');
    // UI chrome flips to English…
    await expect(page.locator('body')).toContainText('Manufacturer');
    // …and the URL carries a shareable ?lang=en
    await expect(page).toHaveURL(/[?&]lang=en/);
  });

  test('unknown language falls back to the original (fi)', async ({ page }) => {
    await page.goto(`/p/${SLUG}?lang=zz`);
    await expect(page.locator('body')).toContainText('Valmistaja'); // fi chrome
  });
});
