import { expect, test } from '@playwright/test';

/** Phone-sized smoke test: registration, the navigation drawer and the example workspace. */
test('the app is usable on a phone', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Name').fill('Mobile Tester');
  await page.getByLabel('Email').fill('mobile@whatif.test');
  await page.getByLabel('Password').fill('local-dev-only-password-3');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Explore the example/ }).click();
  await expect(page).toHaveURL(/\/decisions\//);
  await expect(page.locator('.compare-table')).toContainText('Move to Berlin');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('dialog').or(page.locator('.drawer')).getByRole('link', { name: 'Journal' }).click();
  await expect(page.getByRole('heading', { name: 'Decision journal' })).toBeVisible();
});
