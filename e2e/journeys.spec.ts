import { expect, test, type Page } from '@playwright/test';
import { ADMIN, MEMBER } from './fixtures';

/**
 * Critical user journeys, run in order against one fresh instance:
 * register → onboarding → describe a decision → edit assumptions → compare →
 * milestones → decide → check in → report → journal → privacy/authorization.
 */
test.describe.configure({ mode: 'serial' });

let page: Page;
let decisionUrl = '';

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});
test.afterAll(async () => {
  await page.close();
});

test('first visitor creates the administrator account, lands on the welcome screen and sets up a baseline', async () => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/signin/);
  await expect(page.getByText('No accounts exist yet')).toBeVisible();
  await page.getByRole('link', { name: 'Create the administrator account' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your instance' })).toBeVisible();
  await page.getByLabel('Name').fill(ADMIN.name);
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  // Question-first: no forced questionnaire.
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'What decision are you facing?' })).toBeVisible();
  await page.goto('/onboarding');
  await page.getByLabel('Country').selectOption('France');
  await page.getByLabel('City').fill('Lyon');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Money, if you’d like' })).toBeVisible();
  await expect(page.getByLabel('Currency')).toHaveValue('EUR');
  await page.getByLabel('Gross annual income').fill('48000');
  await page.getByLabel('Tax & social contributions').fill('27');
  await page.getByLabel('Rent or housing').fill('900');
  await page.getByLabel('Other living costs').fill('1100');
  await page.getByLabel('Cash savings').fill('15000');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'What matters to you' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'How far ahead do you plan?' })).toBeVisible();
  await page.getByRole('button', { name: '5 years', exact: true }).click();
  await page.getByRole('button', { name: 'Go to overview' }).click();

  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'What decision are you facing?' })).toBeVisible();
});

test('a natural-language question becomes a reviewable decision', async () => {
  await page.getByLabel('Your decision').fill('What if I move from Lyon to Paris for a better job?');
  await page.getByRole('button', { name: 'Set up scenarios' }).click();
  await expect(page).toHaveURL(/\/decisions\/new\?q=/);
  await expect(page.getByLabel('Your decision')).toHaveValue('What if I move from Lyon to Paris for a better job?');
  await page.getByRole('button', { name: 'Set up scenarios' }).click();

  await expect(page.getByText('Review before creating')).toBeVisible();
  await expect(page.getByLabel('Type of decision')).toHaveValue('city_move');
  await expect(page.getByLabel('Scenario name').first()).toHaveValue('Stay in Lyon');
  await expect(page.getByLabel('Scenario name').nth(1)).toHaveValue('Move to Paris');
  // Baseline values come from the profile; unknown destination values are not invented.
  await expect(page.getByText('Needs input').first()).toBeVisible();
  await page.getByRole('button', { name: 'Create decision' }).click();

  await expect(page).toHaveURL(/\/decisions\/[0-9a-f-]+\?tab=scenarios/);
  decisionUrl = page.url().split('?')[0]!;
  await expect(page.getByRole('heading', { level: 2, name: 'Move to Paris' })).toBeVisible();
});

test('editing an assumption recalculates instantly and saves a versioned run', async () => {
  const salary = page.getByLabel('Gross annual salary', { exact: true });
  await salary.click();
  await salary.fill('62000');
  await salary.press('Enter');
  await page.getByLabel('Effective tax & social contributions', { exact: true }).fill('30');
  await page.getByLabel('Rent or housing cost', { exact: true }).fill('1400');
  await page.getByLabel('Other living costs', { exact: true }).fill('1300');
  await page.getByLabel('Other living costs', { exact: true }).press('Tab');

  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.run-record')).toContainText('Saved run');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('Verified: re-running the stored inputs gives an identical result.')).toBeVisible();

  // Adding a range enables best/worst cases and the uncertainty band.
  const row = page.locator('.var-row', { has: page.getByLabel('Gross annual salary', { exact: true }) });
  await row.getByRole('button', { name: 'Range' }).click();
  await page.getByLabel('Gross annual salary low').fill('55000');
  await page.getByLabel('Gross annual salary high').fill('70000');
  await page.getByLabel('Gross annual salary high').press('Tab');
  await expect(page.getByText('80 % of simulated outcomes').first()).toBeVisible();
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 15_000 });
});

test('a reload keeps every change (persistence)', async () => {
  await page.reload();
  await expect(page.getByLabel('Gross annual salary', { exact: true })).toHaveValue('62,000');
  await expect(page.getByLabel('Gross annual salary low')).toHaveValue('55,000');
});

test('scenarios can be duplicated without affecting each other', async () => {
  await page.locator('.scenario-head').getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Move to Paris (copy)' })).toBeVisible();
  await page.getByLabel('Gross annual salary', { exact: true }).fill('90000');
  await page.getByLabel('Gross annual salary', { exact: true }).press('Tab');
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 15_000 });
  await page.locator('.rail-item', { hasText: 'Move to Paris' }).filter({ hasNotText: '(copy)' }).click();
  await expect(page.getByLabel('Gross annual salary', { exact: true })).toHaveValue('62,000');
});

test('the comparison shows every scenario side by side', async () => {
  await page.getByRole('tab', { name: 'Compare' }).click();
  await expect(page.getByRole('heading', { name: 'Key differences' })).toBeVisible();
  await expect(page.locator('.compare-table')).toContainText('Net worth at horizon');
  await expect(page.locator('.compare-table thead')).toContainText('Stay in Lyon');
  await expect(page.locator('.compare-table thead')).toContainText('Move to Paris (copy)');
  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.locator('table').first()).toContainText('Date');
});

test('the summary explains robustness, break-even and what would change the outcome', async () => {
  await page.getByRole('tab', { name: 'Summary' }).click();
  await expect(page.getByText('Highest expected outcome')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How robust is each path?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'When does it pay off?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Commonly overlooked costs' })).toBeVisible();
  await expect(page.locator('.glance-item')).toHaveCount(3);
});

test('goals can be set and are evaluated for every scenario', async () => {
  await page.locator('.ws-header').getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Simulation settings & goals' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Add goal' }).click();
  await dialog.getByLabel('Goal name').fill('Comfortable cushion');
  await dialog.getByLabel('Target').fill('20000');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('tab', { name: 'Summary' }).click();
  await expect(page.locator('.summary')).toContainText('Comfortable cushion');
  await expect(page.locator('.summary table').filter({ hasText: 'Comfortable cushion' })).toContainText('%');
});

test('the lab runs experiments without changing the scenario', async () => {
  await page.getByRole('tab', { name: 'Lab' }).click();
  await expect(page.getByRole('heading', { name: 'Decision Lab' })).toBeVisible();
  await page.getByLabel('Scenario to experiment on').selectOption({ label: 'Move to Paris' });
  await page.getByLabel('Gross annual salary value').fill('50000');
  await page.getByLabel('Gross annual salary value').press('Tab');
  await expect(page.locator('.lab-compare')).toContainText('Difference');
  await expect(page.locator('.lab-compare tbody tr').first()).toContainText(/-€\d[\d,]*/);
  await page.getByLabel('Experiment name').fill('Lower offer');
  await page.getByRole('button', { name: 'Save experiment' }).click();
  await expect(page.locator('.exp-row')).toContainText('Lower offer');
  await page.getByRole('tab', { name: 'Scenarios' }).click();
  await page.locator('.rail-item', { hasText: 'Move to Paris' }).filter({ hasNotText: '(copy)' }).click();
  await expect(page.getByLabel('Gross annual salary', { exact: true })).toHaveValue('62,000');
  await page.getByRole('tab', { name: 'Lab' }).click();
  await page.locator('.exp-row', { hasText: 'Lower offer' }).getByRole('button', { name: 'As scenario' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Lower offer' })).toBeVisible();
});

test('milestones can be added to the timeline', async () => {
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await page.getByRole('button', { name: 'Add milestone' }).click();
  await page.getByLabel('Title').fill('Sign the Paris lease');
  await page.getByRole('dialog').getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('.timeline-list')).toContainText('Sign the Paris lease');
  await expect(page.locator('.timeline-list')).toContainText('Projected');
});

test('risks and sensitivity explain what matters', async () => {
  await page.getByRole('tab', { name: 'Risks & sensitivity' }).click();
  await expect(page.getByRole('heading', { name: 'Which assumptions matter most' })).toBeVisible();
  await page.getByLabel('New note').fill('Paris rents could rise faster than inflation.');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.notes-columns')).toContainText('Paris rents could rise');
});

test('the AI analyst is optional and explains how to enable it', async () => {
  await page.getByRole('tab', { name: 'Analyst' }).click();
  await expect(page.getByText('No AI analyst is connected.')).toBeVisible();
  // Evidence works without AI.
  await expect(page.getByRole('heading', { name: 'Evidence' })).toBeVisible();
});

test('recording a decision pins the projection and enables reality check-ins', async () => {
  await page.getByRole('tab', { name: 'Decide' }).click();
  await page.locator('.choice-option', { has: page.getByText('Move to Paris', { exact: true }) }).getByRole('radio').check();
  await page.getByLabel('Why this path?').fill('Better career prospects.');
  await page.getByRole('button', { name: 'Record decision' }).click();
  await expect(page.getByText('Chosen path')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Plan versus reality' })).toBeVisible();

  await page.getByRole('button', { name: 'Add check-in' }).click();
  await page.getByLabel('Net worth today').fill('16000');
  await page.getByRole('button', { name: 'Add entry' }).click();
  await expect(page.locator('.decide table')).toContainText('€16,000');
});

test('a report can be generated, viewed and downloaded as PDF', async () => {
  await page.getByRole('button', { name: 'Generate report' }).click();
  await expect(page).toHaveURL(/\/reports\//);
  for (const h of ['Decision overview', 'Current baseline', 'Key assumptions', 'Financial projections', 'Timeline', 'Sensitivity analysis', 'Main trade-offs', 'Uncertainties', 'Final decision']) {
    await expect(page.getByRole('heading', { name: new RegExp(h) })).toBeVisible();
  }
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.pdf$/);
});

test('the journal records reasoning and lists the decision entry', async () => {
  await page.goto('/journal');
  await expect(page.locator('.journal')).toContainText('Decided: Move to Paris');
  await page.getByRole('button', { name: 'New entry' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Type').selectOption('reflection');
  await dialog.getByLabel('Title').fill('First impressions');
  await dialog.getByLabel('Entry').fill('The commute is shorter than expected.');
  await dialog.getByRole('button', { name: 'Add entry' }).click();
  await expect(page.locator('.journal')).toContainText('First impressions');
});

test('the decisions list supports search', async () => {
  await page.goto('/decisions');
  await expect(page.locator('.list')).toContainText('Paris');
  await page.getByLabel('Search decisions').fill('nothing matches this');
  await expect(page.getByText('No decisions match')).toBeVisible();
});

test('another user cannot open someone else’s decision', async ({ browser }) => {
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await other.goto('/register');
  await other.getByLabel('Name').fill(MEMBER.name);
  await other.getByLabel('Email').fill(MEMBER.email);
  await other.getByLabel('Password').fill(MEMBER.password);
  await other.getByRole('button', { name: 'Create account' }).click();
  await expect(other).toHaveURL('/');

  const api = await other.request.get(`/api/decisions/${decisionUrl.split('/').pop()}`);
  expect(api.status()).toBe(404);
  await other.goto(decisionUrl);
  await expect(other.getByText('We couldn’t load this')).toBeVisible();
  await expect(other.getByText('Decision not found.')).toBeVisible();
  await ctx.close();
});

test('signing out ends the session and signing in restores it', async () => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await expect(page).toHaveURL(/\/signin/);
  await page.goto(decisionUrl);
  await expect(page).toHaveURL(/\/signin/);
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(decisionUrl);
});
