import { Hono } from 'hono';
import type { AppEnv } from '../env';
import type { MeResponse, SetupStatus } from '../../../shared/types';
import { setupInput } from '../../../shared/schemas';
import { ApiError } from '../lib/errors';
import { hashPin } from '../lib/crypto';
import { newId } from '../lib/ids';
import { meResponse } from '../lib/members';
import { startSession } from '../lib/session';
import { readJson } from '../lib/validate';

// First run: one team per deployment. Once a team exists, setup is closed for good.
export const setupRoutes = new Hono<AppEnv>();

async function teamExists(db: D1Database): Promise<boolean> {
  return (await db.prepare('SELECT 1 AS x FROM teams LIMIT 1').first()) !== null;
}

const alreadySetUp = () =>
  new ApiError(409, 'already_set_up', 'This team is already set up. Sign in with your name and PIN instead.');

setupRoutes.get('/status', async (c) => {
  return c.json<SetupStatus>({ needs_setup: !(await teamExists(c.env.DB)) });
});

setupRoutes.post('/', async (c) => {
  const input = await readJson(c, setupInput);
  const db = c.env.DB;
  if (await teamExists(db)) throw alreadySetUp();

  const [teamPin, ownerPin] = await Promise.all([hashPin(input.team_pin), hashPin(input.owner_pin)]);
  const teamId = newId();
  const ownerId = newId();
  const now = Date.now();

  // One transaction; the NOT EXISTS guard makes a second, racing setup a no-op.
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO teams (id, name, pin_hash, pin_salt, created_at)
         SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM teams)`,
      )
      .bind(teamId, input.team_name, teamPin.hash, teamPin.salt, now),
    db
      .prepare(
        `INSERT INTO members (id, team_id, name, role, pin_hash, pin_salt, active, created_at)
         SELECT ?, ?, ?, 'owner', ?, ?, 1, ? WHERE EXISTS (SELECT 1 FROM teams WHERE id = ?)`,
      )
      .bind(ownerId, teamId, input.owner_name, ownerPin.hash, ownerPin.salt, now, teamId),
  ]);
  if (results[1]?.meta.changes !== 1) throw alreadySetUp();

  await startSession(c, ownerId);
  const me = await meResponse(db, { id: ownerId, team_id: teamId, name: input.owner_name, role: 'owner' });
  return c.json<MeResponse>(me, 201);
});
