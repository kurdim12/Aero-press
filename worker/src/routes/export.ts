import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { EXPORT_PAGE, type ExportPage, type ExportPart } from '../../../shared/types';
import { exportQuery } from '../../../shared/schemas';
import { requireMember, requireOwner } from '../middleware/auth';
import { readQuery } from '../lib/validate';

export const exportRoutes = new Hono<AppEnv>();
exportRoutes.use('*', requireMember, requireOwner);

// Tables paged by their own id. PIN hashes and sessions are never exported.
const BY_ID: Partial<Record<ExportPart, string>> = {
  beans: 'SELECT * FROM beans WHERE team_id = ?1 AND id > ?2 ORDER BY id LIMIT ?3',
  recipes: 'SELECT * FROM recipes WHERE team_id = ?1 AND id > ?2 ORDER BY id LIMIT ?3',
  brews: 'SELECT * FROM brews WHERE team_id = ?1 AND id > ?2 ORDER BY id LIMIT ?3',
  duels: 'SELECT * FROM duels WHERE team_id = ?1 AND id > ?2 ORDER BY id LIMIT ?3',
  readiness_reports: 'SELECT * FROM readiness_reports WHERE team_id = ?1 AND id > ?2 ORDER BY id LIMIT ?3',
  ai_calls: 'SELECT * FROM ai_calls WHERE team_id = ?1 AND id > ?2 ORDER BY id LIMIT ?3',
  members: `SELECT id, team_id, name, role, active, (role = 'barista' AND pin_hash IS NOT NULL) AS has_personal_pin, created_at
              FROM members WHERE team_id = ?1 AND id > ?2 ORDER BY id LIMIT ?3`,
};

// Rows that belong to a duel, paged a window of duels at a time (cursor: the last duel id).
const BY_DUEL: Partial<Record<ExportPart, string>> = {
  duel_judges: 'duel_judges',
  duel_votes: 'duel_votes',
};

/**
 * GET /api/export?part=<table>&after=<cursor>: one page of one table. The browser collects
 * every page into a single backup file, so no request has to build the whole thing.
 */
exportRoutes.get('/', async (c) => {
  const { part, after } = readQuery(c, exportQuery);
  const team = c.get('member').team_id;
  const db = c.env.DB;

  if (part === 'team') {
    const row = await db
      .prepare('SELECT id, name, champ_name, champ_date, comp_coffee_notes, ai_monthly_budget_usd, created_at FROM teams WHERE id = ?')
      .bind(team)
      .first<Record<string, unknown>>();
    return c.json<ExportPage>({ part, rows: row ? [row] : [], next: null });
  }

  const byId = BY_ID[part];
  if (byId) {
    const { results } = await db.prepare(byId).bind(team, after ?? '', EXPORT_PAGE).all<Record<string, unknown>>();
    const last = results.at(-1);
    return c.json<ExportPage>({ part, rows: results, next: results.length === EXPORT_PAGE && last ? String(last.id) : null });
  }

  const table = BY_DUEL[part];
  if (!table) return c.json<ExportPage>({ part, rows: [], next: null });
  const window = await db
    .prepare('SELECT id FROM duels WHERE team_id = ? AND id > ? ORDER BY id LIMIT ?')
    .bind(team, after ?? '', EXPORT_PAGE)
    .all<{ id: string }>();
  const ids = window.results.map((r) => r.id);
  if (ids.length === 0) return c.json<ExportPage>({ part, rows: [], next: null });
  const first = ids[0]!;
  const last = ids[ids.length - 1]!;
  const { results } = await db
    .prepare(
      `SELECT t.* FROM ${table} t JOIN duels d ON d.id = t.duel_id
        WHERE d.team_id = ? AND t.duel_id >= ? AND t.duel_id <= ? ORDER BY t.duel_id`,
    )
    .bind(team, first, last)
    .all<Record<string, unknown>>();
  return c.json<ExportPage>({ part, rows: results, next: ids.length === EXPORT_PAGE ? last : null });
});
