import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the production build (`npm run build`) served by
 * the real server, with a fresh in-memory PostgreSQL (PGlite) per run.
 */
const PORT = 3100;
// Set E2E_BASE_URL to test an already running instance (e.g. one backed by PostgreSQL).
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: external ?? `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: '**/mobile.spec.ts' },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: '**/mobile.spec.ts' },
  ],
  webServer: external
    ? undefined
    : {
    command: 'node apps/server/dist/index.js',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: 'production',
      APP_SECRET: 'e2e-only-secret-e2e-only-secret-e2e-only-secret',
      DATABASE_URL: 'pglite:memory',
      HOST: '127.0.0.1',
      PORT: String(PORT),
      WEB_DIST: 'apps/web/dist',
      LOG_LEVEL: 'warn',
      SCRYPT_COST: '4096',
      AUTH_RATE_LIMIT_PER_MINUTE: '1000',
    },
  },
});
