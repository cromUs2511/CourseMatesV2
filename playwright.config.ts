import { defineConfig } from '@playwright/test';

// The suite always exercises the production bundle over plain HTTP, so NODE_ENV=test
// keeps the HTTPS/single-instance production gate out of the way while still serving
// dist/ exactly as `npm start` would. Local .env files stay unloaded so a real AI key
// can never reach a test server.
const webServerEnv = {
  PORT: '3100',
  HOST: '127.0.0.1',
  NODE_ENV: 'test',
  LOAD_LOCAL_ENV: 'false',
  SINGLE_INSTANCE: 'true',
  GEMINI_API_KEY: '',
  GROQ_API_KEY: '',
  YOUTUBE_API_KEY: '',
};

const channel = process.env.PW_CHANNEL || 'chrome';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:3100', channel, headless: true, trace: 'retain-on-failure' },
  webServer: {
    command:
      process.env.TEST_DEV === 'true' ? 'npm run dev' : 'node dist/.server/server.cjs --production',
    url: 'http://127.0.0.1:3100/api/health',
    env: webServerEnv,
    reuseExistingServer: false,
  },
});
