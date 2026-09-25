import { Hono } from 'hono';
import type { AppEnv } from '../env';
import type { MemberRow, MembersResponse, OkResponse } from '../../../shared/types';
import { addMemberInput, setPinInput, updateMemberInput } from '../../../shared/schemas';
import { initialsOf } from '../../../shared/initials';
import { requireMember, requireOwner } from '../middleware/auth';
import { ApiError } from '../lib/errors';
import { hashPin, verifyPin } from '../lib/crypto';
import { newId } from '../lib/ids';
import { getTeamMember, isUniqueViolation, listMembers } from '../lib/members';
import { readJson } from '../lib/validate';

export const memberRoutes = new Hono<AppEnv>();
memberRoutes.use('*', requireMember);

const nameTaken = (name: string) =>
  new ApiError(409, 'name_taken', `${name} is already on the team. Add a last initial to tell them apart.`);

/** Owners see everyone with sign-in details; baristas see active teammates (for picking judges). */
memberRoutes.get('/', async (c) => {
  const me = c.get('member');
  const members = await listMembers(c.env.DB, me.team_id, me.role === 'owner');
  return c.json<MembersResponse>({ members });
});

/** Owner adds a barista. New baristas sign in with the team PIN. */
memberRoutes.post('/', requireOwner, async (c) => {
  const { name } = await readJson(c, addMemberInput);
  const me = c.get('member');
  const id = newId();
  const now = Date.now();
  try {
    await c.env.DB.prepare(
      `INSERT INTO members (id, team_id, name, role, pin_hash, pin_salt, active, created_at)
       VALUES (?, ?, ?, 'barista', NULL, NULL, 1, ?)`,
    )
      .bind(id, me.team_id, name, now)
      .run();
  } catch (err) {
    if (isUniqueViolation(err)) throw nameTaken(name);
    throw err;
  }
  const row: MemberRow = {
    id,
    name,
    role: 'barista',
    initials: initialsOf(name),
    active: true,
    pin_type: 'team',
    locked_until: null,
    created_at: now,
  };
  return c.json(row, 201);
});

/** Deactivate (signs them out everywhere) or reactivate a barista. */
memberRoutes.patch('/:id', requireOwner, async (c) => {
  const { active } = await readJson(c, updateMemberInput);
  const me = c.get('member');
  const db = c.env.DB;
  const target = await getTeamMember(db, me.team_id, c.req.param('id'));
  if (target.role === 'owner') {
    throw new ApiError(400, 'owner_always_active', 'The owner account stays active. Deactivate baristas only.');
  }
  try {
    await db.batch([
      db.prepare('UPDATE members SET active = ? WHERE id = ? AND team_id = ?').bind(active ? 1 : 0, target.id, me.team_id),
      ...(active ? [] : [db.prepare('DELETE FROM sessions WHERE member_id = ?').bind(target.id)]),
    ]);
  } catch (err) {
    if (isUniqueViolation(err)) throw nameTaken(target.name);
    throw err;
  }
  return c.json<OkResponse>({ ok: true });
});

/**
 * Reset a PIN. For the owner row this is the owner PIN. For a barista it sets a
 * personal PIN that replaces the team PIN for them. Clears any lockout and signs
 * that member out of their other devices.
 */
memberRoutes.put('/:id/pin', requireOwner, async (c) => {
  const { pin } = await readJson(c, setPinInput);
  const me = c.get('member');
  const db = c.env.DB;
  const target = await getTeamMember(db, me.team_id, c.req.param('id'));

  if (target.role === 'owner') {
    const team = await db
      .prepare('SELECT pin_hash, pin_salt FROM teams WHERE id = ?')
      .bind(me.team_id)
      .first<{ pin_hash: string; pin_salt: string }>();
    if (team && (await verifyPin(pin, { hash: team.pin_hash, salt: team.pin_salt }))) {
      throw new ApiError(400, 'pin_matches_team', 'The owner PIN must differ from the team PIN. Pick another PIN.', {
        field: 'pin',
      });
    }
  }

  const hashed = await hashPin(pin);
  await db.batch([
    db.prepare('UPDATE members SET pin_hash = ?, pin_salt = ? WHERE id = ? AND team_id = ?').bind(
      hashed.hash,
      hashed.salt,
      target.id,
      me.team_id,
    ),
    db.prepare('DELETE FROM login_attempts WHERE member_id = ?').bind(target.id),
    db.prepare('DELETE FROM sessions WHERE member_id = ? AND id != ?').bind(target.id, me.session_id),
  ]);
  return c.json<OkResponse>({ ok: true });
});

/** A barista goes back to signing in with the team PIN. */
memberRoutes.delete('/:id/pin', requireOwner, async (c) => {
  const me = c.get('member');
  const db = c.env.DB;
  const target = await getTeamMember(db, me.team_id, c.req.param('id'));
  if (target.role === 'owner') {
    throw new ApiError(400, 'owner_needs_pin', 'The owner always signs in with the owner PIN. Set a new one instead.');
  }
  await db.batch([
    db.prepare('UPDATE members SET pin_hash = NULL, pin_salt = NULL WHERE id = ? AND team_id = ?').bind(target.id, me.team_id),
    db.prepare('DELETE FROM login_attempts WHERE member_id = ?').bind(target.id),
  ]);
  return c.json<OkResponse>({ ok: true });
});
