import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
import { adminUrl, TEST_APP_PW, urlFor } from '@turnosala/db';

export const E2E_DB = 'e2e_web';
const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Secreto efímero solo para esta ejecución (no se guarda en ningún sitio).
process.env.E2E_AUTH_SECRET ??= randomBytes(32).toString('hex');

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: { baseURL: BASE_URL, locale: 'es-ES', timezoneId: 'Europe/Madrid', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Requiere `npm run build -w @turnosala/web` previo (lo hace `npm run e2e`).
    command: `npm run start -w @turnosala/web -- -p ${PORT} -H 127.0.0.1`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      APP_MODE: 'sandbox',
      DATABASE_URL: urlFor(adminUrl(), 'app', TEST_APP_PW, E2E_DB),
      BETTER_AUTH_URL: BASE_URL,
      BETTER_AUTH_SECRET: process.env.E2E_AUTH_SECRET,
    },
  },
});
