// Bundles /migrations into the Worker (worker/src/migrations.gen.ts) so it can bring its own
// database up to date. Statements are split by wrangler's own splitter, via the same helper the
// tests use. Run after adding or changing a migration: npm run gen:migrations
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readD1Migrations } from '@cloudflare/vitest-pool-workers';

const migrations = await readD1Migrations(fileURLToPath(new URL('../migrations', import.meta.url)));
const target = new URL('../worker/src/migrations.gen.ts', import.meta.url);

writeFileSync(
  target,
  `// Generated from /migrations by scripts/gen-migrations.mjs. Don't edit: run npm run gen:migrations.
export interface Migration {
  name: string;
  queries: string[];
}

export const MIGRATIONS: Migration[] = ${JSON.stringify(migrations, null, 2)};
`,
);
console.log(`Wrote ${migrations.length} migration(s) to worker/src/migrations.gen.ts`);
