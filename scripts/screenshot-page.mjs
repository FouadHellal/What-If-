// Dev utility: screenshot one path. Usage: SHOT_EMAIL=… SHOT_PASSWORD=… node scripts/screenshot-page.mjs <path> <out.png> [light|dark] [width]
import { chromium } from '@playwright/test';
const [path, out, theme = 'light', width = '1440'] = process.argv.slice(2);
const base = process.env.BASE_URL ?? 'http://localhost:5173';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: Number(width), height: 900 }, colorScheme: theme });
const p = await ctx.newPage();
await p.goto(base + '/signin');
await p.fill('#email', process.env.SHOT_EMAIL);
await p.fill('#password', process.env.SHOT_PASSWORD);
await p.click('button[type=submit]');
await p.waitForURL((u) => !u.pathname.startsWith('/signin'));
await p.goto(base + path);
await p.waitForTimeout(1200);
await p.screenshot({ path: out, fullPage: process.env.FULL === '1' });
await b.close();
