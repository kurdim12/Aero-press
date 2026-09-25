import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    test: {
      projects: [
        {
          // Pure functions (formulas, Elo, phases, import mapping, AI JSON validation).
          test: {
            name: 'unit',
            include: ['test/unit/**/*.test.ts'],
            environment: 'node',
          },
        },
        {
          // API integration tests inside the Workers runtime with a real local D1.
          plugins: [
            cloudflareTest({
              main: './worker/src/index.ts',
              wrangler: { configPath: './wrangler.jsonc' },
              miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
            }),
          ],
          test: {
            name: 'worker',
            include: ['worker/test/**/*.test.ts'],
          },
        },
      ],
    },
  };
});
