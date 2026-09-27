import { applyD1Migrations, reset } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyPendingMigrations } from '../src/lib/schema';
import { Client, freshDb } from './helpers';

// A deploy that skipped the migrations: the Worker runs, but its database has no tables.
beforeEach(() => reset());

/** Every table and index with its SQL, except the migrations bookkeeping (compared separately). */
async function schema() {
  const { results } = await env.DB.prepare(
    `SELECT type, name, sql FROM sqlite_master
     WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'
     ORDER BY name`,
  ).all();
  return results;
}

async function trackingColumns() {
  const { results } = await env.DB.prepare('PRAGMA table_info(d1_migrations)').all<{ name: string; type: string }>();
  return results.map((c) => `${c.name} ${c.type}`);
}

describe('a database the deploy left without tables', () => {
  it('gets its tables on the first request, and the app works on the retry', async () => {
    const client = new Client();
    const first = await client.get('/api/setup/status');
    expect(first.status).toBe(503);
    expect(first.body.error.code).toBe('database_updated');

    const again = await client.get('/api/setup/status');
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ needs_setup: true });
  });

  it('ends up with the same schema and bookkeeping as wrangler, so neither path repeats the other', async () => {
    expect(await applyPendingMigrations(env.DB)).toBe(1);
    const selfApplied = await schema();
    const selfTracking = await trackingColumns();
    expect(selfApplied.length).toBeGreaterThan(20);

    // wrangler-style apply on top finds nothing to do (it would throw re-creating a table).
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    expect(await schema()).toEqual(selfApplied);

    // The other order: wrangler first, then the Worker has nothing left to apply.
    await freshDb();
    expect(await schema()).toEqual(selfApplied);
    expect(await trackingColumns()).toEqual(selfTracking);
    expect(await applyPendingMigrations(env.DB)).toBe(0);
  });
});
