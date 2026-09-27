import { Hono } from 'hono';
import type { AppEnv } from '../env';
import type { MeResponse, OkResponse, TeamSettings } from '../../../shared/types';
import { setPinInput, teamSettingsInput } from '../../../shared/schemas';
import { requireMember, requireOwner } from '../middleware/auth';
import { ApiError, notFound } from '../lib/errors';
import { hashPin, verifyPin } from '../lib/crypto';
import { meResponse } from '../lib/members';
import { readJson } from '../lib/validate';

export const meRoutes = new Hono<AppEnv>();
meRoutes.use('*', requireMember);

meRoutes.get('/', async (c) => c.json<MeResponse>(await meResponse(c.env.DB, c.get('member'))));

export const teamRoutes = new Hono<AppEnv>();
teamRoutes.use('*', requireMember);

type SettingsRow = Omit<TeamSettings, 'ai_auto_tips'> & { ai_auto_tips: number };

async function readSettings(db: D1Database, teamId: string): Promise<TeamSettings> {
  const row = await db
    .prepare(
      `SELECT name, champ_name, champ_date, comp_coffee_notes, ai_monthly_budget_usd, ai_coach_model, ai_quick_model, ai_auto_tips
         FROM teams WHERE id = ?`,
    )
    .bind(teamId)
    .first<SettingsRow>();
  if (!row) throw notFound('team');
  return { ...row, ai_auto_tips: row.ai_auto_tips === 1 };
}

/** Team name, championship details and the AI settings. Everyone may read them. */
teamRoutes.get('/', async (c) => c.json<TeamSettings>(await readSettings(c.env.DB, c.get('member').team_id)));

/** Owner saves the team settings (the whole form each time). */
teamRoutes.put('/', requireOwner, async (c) => {
  const input = await readJson(c, teamSettingsInput);
  const me = c.get('member');
  const budget = Math.round(input.ai_monthly_budget_usd * 100) / 100;
  const db = c.env.DB;
  // The AI fields are optional in the body: leaving one out keeps what's saved.
  await db
    .prepare(
      `UPDATE teams SET name = ?, champ_name = ?, champ_date = ?, comp_coffee_notes = ?, ai_monthly_budget_usd = ?,
              ai_coach_model = CASE WHEN ? THEN ? ELSE ai_coach_model END,
              ai_quick_model = CASE WHEN ? THEN ? ELSE ai_quick_model END,
              ai_auto_tips = CASE WHEN ? THEN ? ELSE ai_auto_tips END
        WHERE id = ?`,
    )
    .bind(
      input.name,
      input.champ_name ?? null,
      input.champ_date ?? null,
      input.comp_coffee_notes ?? null,
      budget,
      input.ai_coach_model !== undefined ? 1 : 0,
      input.ai_coach_model ?? null,
      input.ai_quick_model !== undefined ? 1 : 0,
      input.ai_quick_model ?? null,
      input.ai_auto_tips !== undefined ? 1 : 0,
      input.ai_auto_tips ? 1 : 0,
      me.team_id,
    )
    .run();
  return c.json<TeamSettings>(await readSettings(db, me.team_id));
});

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
