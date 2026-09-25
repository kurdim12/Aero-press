import { Hono } from 'hono';
import type { AppEnv } from '../env';
import type { MeResponse, OkResponse } from '../../../shared/types';
import { setPinInput } from '../../../shared/schemas';
import { requireMember, requireOwner } from '../middleware/auth';
import { ApiError } from '../lib/errors';
import { hashPin, verifyPin } from '../lib/crypto';
import { meResponse } from '../lib/members';
import { readJson } from '../lib/validate';

export const meRoutes = new Hono<AppEnv>();
meRoutes.use('*', requireMember);

meRoutes.get('/', async (c) => c.json<MeResponse>(await meResponse(c.env.DB, c.get('member'))));

export const teamRoutes = new Hono<AppEnv>();
teamRoutes.use('*', requireMember);

/** Owner changes the team PIN. Existing sessions stay signed in. */
teamRoutes.put('/pin', requireOwner, async (c) => {
  const { pin } = await readJson(c, setPinInput);
  const me = c.get('member');
  const db = c.env.DB;
  const owner = await db
    .prepare("SELECT pin_hash, pin_salt FROM members WHERE team_id = ? AND role = 'owner'")
    .bind(me.team_id)
    .first<{ pin_hash: string | null; pin_salt: string | null }>();
  if (owner?.pin_hash && owner.pin_salt && (await verifyPin(pin, { hash: owner.pin_hash, salt: owner.pin_salt }))) {
    throw new ApiError(400, 'pin_matches_owner', 'The team PIN must differ from the owner PIN. Pick another PIN.', {
      field: 'pin',
    });
  }
  const hashed = await hashPin(pin);
  await db.prepare('UPDATE teams SET pin_hash = ?, pin_salt = ? WHERE id = ?').bind(hashed.hash, hashed.salt, me.team_id).run();
  return c.json<OkResponse>({ ok: true });
});
