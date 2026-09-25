import { Hono } from 'hono';
import type { AppEnv } from '../env';
import type { MeResponse, OkResponse, Role, SignInList } from '../../../shared/types';
import { loginInput } from '../../../shared/schemas';
import { initialsOf } from '../../../shared/initials';
import { ApiError } from '../lib/errors';
import { type PinHash, verifyPin } from '../lib/crypto';
import { meResponse, pinTypeOf } from '../lib/members';
import { endSession, startSession } from '../lib/session';
import { readJson } from '../lib/validate';

export const MAX_FAILURES = 5;
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;

export const authRoutes = new Hono<AppEnv>();

const notSetUp = () => new ApiError(404, 'needs_setup', 'This app has not been set up yet. Reload to start setup.');

const lockedOut = (msLeft: number) => {
  const minutes = Math.max(1, Math.ceil(msLeft / 60_000));
  return new ApiError(
    429,
    'locked',
    `Too many wrong PINs. Sign-in for this name is locked for ${minutes} more minute${minutes === 1 ? '' : 's'}.`,
    { retry_after_ms: msLeft },
  );
};

/** Public: the names shown on the sign-in screen. */
authRoutes.get('/members', async (c) => {
  const db = c.env.DB;
  const team = await db.prepare('SELECT id, name FROM teams ORDER BY created_at LIMIT 1').first<{ id: string; name: string }>();
  if (!team) throw notSetUp();
  const { results } = await db
    .prepare(
      `SELECT id, name, role, pin_hash IS NOT NULL AS has_pin
         FROM members WHERE team_id = ? AND active = 1
        ORDER BY name COLLATE NOCASE`,
    )
    .bind(team.id)
    .all<{ id: string; name: string; role: Role; has_pin: number }>();
  return c.json<SignInList>({
    team_name: team.name,
    members: results.map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      initials: initialsOf(m.name),
      pin_type: pinTypeOf(m),
    })),
  });
});

interface LoginRow {
  id: string;
  team_id: string;
  name: string;
  role: Role;
  pin_hash: string | null;
  pin_salt: string | null;
  team_pin_hash: string;
  team_pin_salt: string;
}

authRoutes.post('/login', async (c) => {
  const { member_id, pin } = await readJson(c, loginInput);
  const db = c.env.DB;
  const now = Date.now();

  const member = await db
    .prepare(
      `SELECT m.id, m.team_id, m.name, m.role, m.pin_hash, m.pin_salt,
              t.pin_hash AS team_pin_hash, t.pin_salt AS team_pin_salt
         FROM members m JOIN teams t ON t.id = m.team_id
        WHERE m.id = ? AND m.active = 1`,
    )
    .bind(member_id)
    .first<LoginRow>();
  if (!member) {
    throw new ApiError(404, 'member_not_found', 'That name is no longer on the team. Go back and pick your name again.');
  }

  const attempt = await db
    .prepare('SELECT locked_until FROM login_attempts WHERE member_id = ?')
    .bind(member.id)
    .first<{ locked_until: number | null }>();
  if (attempt?.locked_until && attempt.locked_until > now) throw lockedOut(attempt.locked_until - now);

  // The owner signs in with the owner PIN only. A barista uses a personal PIN
  // if the owner set one, otherwise the team PIN.
  let stored: PinHash | null = null;
  if (member.pin_hash && member.pin_salt) stored = { hash: member.pin_hash, salt: member.pin_salt };
  else if (member.role === 'barista') stored = { hash: member.team_pin_hash, salt: member.team_pin_salt };

  const ok = stored !== null && (await verifyPin(pin, stored));
  if (!ok) {
    // Count the failure inside a rolling 15-minute window, atomically.
    const row = await db
      .prepare(
        `INSERT INTO login_attempts (member_id, failed_count, first_failed_at, locked_until)
         VALUES (?1, 1, ?2, NULL)
         ON CONFLICT (member_id) DO UPDATE SET
           failed_count = CASE WHEN first_failed_at IS NULL OR ?2 - first_failed_at >= ?3
                               THEN 1 ELSE failed_count + 1 END,
           first_failed_at = CASE WHEN first_failed_at IS NULL OR ?2 - first_failed_at >= ?3
                                  THEN ?2 ELSE first_failed_at END
         RETURNING failed_count`,
      )
      .bind(member.id, now, FAILURE_WINDOW_MS)
      .first<{ failed_count: number }>();
    const failures = row?.failed_count ?? 1;
    if (failures >= MAX_FAILURES) {
      await db
        .prepare('UPDATE login_attempts SET failed_count = 0, first_failed_at = NULL, locked_until = ? WHERE member_id = ?')
        .bind(now + LOCK_MS, member.id)
        .run();
      throw lockedOut(LOCK_MS);
    }
    const left = MAX_FAILURES - failures;
    throw new ApiError(
      401,
      'wrong_pin',
      `Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left before a 15-minute lock.`,
      { tries_left: left },
    );
  }

  await db.batch([
    db.prepare('DELETE FROM login_attempts WHERE member_id = ?').bind(member.id),
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
  ]);
  await startSession(c, member.id);
  return c.json<MeResponse>(await meResponse(db, member));
});

authRoutes.post('/logout', async (c) => {
  await endSession(c);
  return c.json<OkResponse>({ ok: true });
});
