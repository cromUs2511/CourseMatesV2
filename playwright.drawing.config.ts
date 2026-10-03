import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Explicit Safari-engine verification; the normal suite continues using Chrome.
export default defineConfig({
  ...base,
  testMatch: 'drawing.spec.ts',
  use: { ...base.use, browserName: 'webkit', channel: undefined },
});
