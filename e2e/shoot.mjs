// Dev utility: captures screenshots of key pages for visual review.
// Usage: node e2e/shoot.mjs <outDir> <decisionId> [theme]
import { chromium } from '@playwright/test';
const [outDir, decisionId, theme = 'light'] = process.argv.slice(2);
const base = process.env.BASE_URL ?? 'http://localhost:5173';
const browser = await chromium.launch();
const pages = [
  ['overview', '/'],
  ['decisions', '/decisions'],
  ['compare', `/decisions/${decisionId}?tab=compare`],
  ['scenarios', `/decisions/${decisionId}?tab=scenarios`],
  ['timeline', `/decisions/${decisionId}?tab=timeline`],
  ['risks', `/decisions/${decisionId}?tab=risks`],
  ['analyst', `/decisions/${decisionId}?tab=analyst`],
  ['decide', `/decisions/${decisionId}?tab=decide`],
  ['new', '/decisions/new'],
  ['journal', '/journal'],
  ['settings', '/settings/profile'],
  ['settings-ai', '/settings/ai'],
];
for (const [vpName, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(base + '/signin');
  await page.fill('#email', process.env.SHOT_EMAIL);
  await page.fill('#password', process.env.SHOT_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'));
  for (const [name, path] of pages) {
    if (vpName === 'mobile' && !['overview', 'compare', 'scenarios', 'new'].includes(name)) continue;
    await page.goto(base + path);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${outDir}/${theme}-${vpName}-${name}.png`, fullPage: process.env.FULL === '1' });
  }
  await ctx.close();
}
await browser.close();
console.log('done');
