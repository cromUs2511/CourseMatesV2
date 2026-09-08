import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:3100', channel: 'chrome', headless: true, trace: 'retain-on-failure' },
  webServer: {
    command: process.env.TEST_DEV === 'true' ? 'npm run dev' : 'node dist/.server/server.cjs --production',
    url: 'http://127.0.0.1:3100/api/health',
    env: { PORT: '3100', HOST: '127.0.0.1', ALLOW_DEMO_LOGIN: 'true', GEMINI_API_KEY: '' },
    reuseExistingServer: false,
  },
});
