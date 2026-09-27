import { readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../worker/src/migrations.gen';

describe('migrations bundled into the Worker', () => {
  it('match /migrations (after changing a migration, run npm run gen:migrations)', async () => {
    expect(MIGRATIONS).toEqual(await readD1Migrations('./migrations'));
  });
});
