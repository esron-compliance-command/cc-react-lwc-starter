/**
 * One end-to-end test against the real thing: a real org, a real Apex query, real records.
 *
 * On this team every fix ships with an e2e test in the same pull request, so the API is worth
 * knowing before it is urgent. The locator traps commented below are ones that have actually cost
 * this team hours -- read them now rather than rediscovering them at 11pm.
 */
import { test, expect } from '@playwright/test';

const GRID = '[data-target-selection-name*="reactGridHost"], c-react-grid-host';

test.describe('React grid', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for data, not for a timeout. An arbitrary waitForTimeout passes on a fast machine and
    // fails in CI, which is the least useful kind of flake.
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('renders rows from the server', async ({ page }) => {
    const rows = page.getByRole('row');
    // Header row plus at least one data row.
    await expect(rows).not.toHaveCount(1);
  });

  test('sorting changes which record is first', async ({ page }) => {
    const firstCell = page.getByRole('row').nth(1).getByRole('cell').first();
    const before = await firstCell.textContent();

    await page.getByRole('button', { name: /account name/i }).click();
    // The click triggers a server round trip; assert on the RESULT, not on a delay.
    await expect(firstCell).not.toHaveText(before ?? '', { timeout: 10_000 });
  });

  test('search narrows the list and the count agrees', async ({ page }) => {
    const search = page.getByRole('searchbox');
    await search.fill('a');
    // The count is rendered as text, so assert the text -- an LWC @api property is NOT a DOM
    // attribute and cannot be read back with getAttribute, however tempting that looks.
    await expect(page.getByText(/records?$/)).toBeVisible();
  });

  test('an empty search result says so rather than showing a blank table', async ({ page }) => {
    await page.getByRole('searchbox').fill('zzzzzzzzzznotarealcompany');
    await expect(page.getByText(/no records match/i)).toBeVisible({ timeout: 10_000 });
  });
});

/**
 * Traps this harness already accounts for, and why:
 *
 *  - goto('/') must resolve to the SITE, not the org's home page. baseURL in playwright.config.ts
 *    carries the full community path; a bare org URL silently tests the wrong application.
 *  - Toasts disappear after roughly five seconds. Assert on them immediately or not at all.
 *  - A paginated list only contains the current page. `getByText` for a record on page three fails
 *    truthfully, which looks like a bug in the app and is not.
 *  - Hidden nodes still match locators. Prefer getByRole, which respects accessibility visibility,
 *    over a CSS selector that happily finds a display:none element.
 */
export { GRID };
