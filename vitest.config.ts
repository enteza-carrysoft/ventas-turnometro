import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/*/src/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'tests/e2e/**', 'tests/fixtures/**'],
  },
});
