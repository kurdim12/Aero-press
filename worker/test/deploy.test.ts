import { reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { Client } from './helpers';

// A deploy that skipped the migrations: the Worker runs, but its database has no tables.
beforeEach(() => reset());

describe('a database without tables', () => {
  it('says the deploy is unfinished instead of a generic server error', async () => {
    const res = await new Client().get('/api/setup/status');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('database_not_ready');
  });
});
