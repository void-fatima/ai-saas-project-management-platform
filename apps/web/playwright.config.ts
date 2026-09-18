import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Require an explicitly named disposable database; never silently use the developer's .env.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/platform_auth_test') {
  throw new Error('E2E requires an explicit DATABASE_URL for disposable platform_auth_test.');
}
const root = fileURLToPath(new URL('../..', import.meta.url));
const env = {
  DATABASE_URL: databaseUrl,
  NODE_ENV: 'test',
  API_PORT: '3000',
  WEB_ORIGIN: 'http://localhost:5173',
  VITE_API_URL: 'http://localhost:3000',
  MAIL_MODE: 'development-file',
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: 'list',
  use: {
    baseURL: env.WEB_ORIGIN,
    browserName: 'chromium',
    channel: process.env.E2E_BROWSER_CHANNEL === 'msedge' ? 'msedge' : undefined,
    // Recovery URLs contain credentials. Do not persist them in traces or screenshots.
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: [
    {
      command: 'node dist/main.js',
      cwd: `${root}/apps/api`,
      url: 'http://localhost:3000/health/ready',
      env,
      reuseExistingServer: false,
    },
    {
      command: 'node node_modules/vite/bin/vite.js --host localhost',
      cwd: `${root}/apps/web`,
      url: env.WEB_ORIGIN,
      env,
      reuseExistingServer: false,
    },
  ],
});
