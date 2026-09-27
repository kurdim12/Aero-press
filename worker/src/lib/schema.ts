// The Worker brings its own database up to date, so a deploy that skipped
// `wrangler d1 migrations apply` (such as Workers Builds with its default deploy command)
// still ends up with the right tables. The bookkeeping matches wrangler's (the d1_migrations
// table, one row per migration file), so either path can run first and the other skips.
import { MIGRATIONS, type Migration } from '../migrations.gen';

const TRACKING_TABLE = `CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;

/** D1's words for a database that is behind the code. */
export function isSchemaBehind(err: unknown): boolean {
  return err instanceof Error && /no such (table|column)/i.test(err.message);
}

/**
 * Apply the migrations the database doesn't have yet, each in one batch (all or nothing),
 * oldest first. Returns how many this call applied.
 */
export async function applyPendingMigrations(db: D1Database, migrations: Migration[] = MIGRATIONS): Promise<number> {
  await db.prepare(TRACKING_TABLE).run();
  const { results } = await db.prepare('SELECT name FROM d1_migrations').all<{ name: string }>();
  const applied = new Set(results.map((row) => row.name));
  let ran = 0;
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    try {
      await db.batch([
        ...migration.queries.map((query) => db.prepare(query)),
        db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(migration.name),
      ]);
      ran++;
    } catch (err) {
      // Another request may have applied it at the same moment; that's fine.
      const done = await db.prepare('SELECT 1 FROM d1_migrations WHERE name = ?').bind(migration.name).first();
      if (!done) throw err;
    }
  }
  return ran;
}

let schemaCheck: Promise<void> | null = null;

/**
 * Once per Worker instance: apply bundled migrations the database hasn't recorded yet, before the
 * first request is handled. Needed for migrations that never make a query fail (new indexes), so
 * the "no such table" path in onError would never run them. A database with no bookkeeping table
 * at all is brand new; the error path sets that up. Never blocks a request on its own failure.
 */
export function ensureCurrentSchema(db: D1Database): Promise<void> {
  schemaCheck ??= (async () => {
    let applied: Set<string>;
    try {
      const { results } = await db.prepare('SELECT name FROM d1_migrations').all<{ name: string }>();
      applied = new Set(results.map((row) => row.name));
    } catch {
      return; // no d1_migrations yet: a fresh database
    }
    if (MIGRATIONS.every((m) => applied.has(m.name))) return;
    await applyPendingMigrations(db);
  })().catch((err: unknown) => {
    schemaCheck = null; // try again on the next request
    console.error('Schema check failed', err instanceof Error ? err.message : String(err));
  });
  return schemaCheck;
}

/** Tests only: forget that this instance already checked. */
export function resetSchemaCheck(): void {
  schemaCheck = null;
}
