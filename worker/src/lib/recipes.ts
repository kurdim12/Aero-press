import { newStanding, replayElo, type EloDuel } from '../../../shared/elo';
import { initialsOf } from '../../../shared/initials';
import type { BrewAverages, BrewRow, Method, RecipeRow, Standing } from '../../../shared/types';
import { ApiError, notFound } from './errors';

/** The brew-defining columns, in the order the form and compare view use. */
export const RECIPE_FIELD_COLUMNS = [
  'name',
  'bean_id',
  'method',
  'filter',
  'dose_g',
  'water_g',
  'temp_c',
  'grinder',
  'grind_setting',
  'water_recipe',
  'bloom_water_g',
  'bloom_ends_s',
  'agitation',
  'press_starts_s',
  'press_duration_s',
  'bypass_g',
  'bypass_temp',
  'other_steps',
  'notes',
] as const;

interface RecipeDbRow {
  id: string;
  team_id: string;
  owner_member_id: string;
  code: string;
  name: string | null;
  parent_id: string | null;
  bean_id: string | null;
  method: Method;
  filter: string | null;
  dose_g: number | null;
  water_g: number | null;
  temp_c: number | null;
  grinder: string | null;
  grind_setting: string | null;
  water_recipe: string | null;
  bloom_water_g: number | null;
  bloom_ends_s: number | null;
  agitation: string | null;
  press_starts_s: number | null;
  press_duration_s: number | null;
  bypass_g: number | null;
  bypass_temp: string | null;
  other_steps: string | null;
  notes: string | null;
  locked: number;
  created_at: number;
  updated_at: number;
  owner_name: string;
  bean_name: string | null;
  parent_code: string | null;
  parent_owner_name: string | null;
  brew_count: number;
}

const RECIPE_SELECT = `
  SELECT r.*, m.name AS owner_name, b.name AS bean_name,
         p.code AS parent_code, pm.name AS parent_owner_name,
         (SELECT COUNT(*) FROM brews w WHERE w.recipe_id = r.id) AS brew_count
    FROM recipes r
    JOIN members m ON m.id = r.owner_member_id
    LEFT JOIN beans b ON b.id = r.bean_id
    LEFT JOIN recipes p ON p.id = r.parent_id
    LEFT JOIN members pm ON pm.id = p.owner_member_id`;

export const displayCode = (ownerName: string, code: string) => `${initialsOf(ownerName)}-${code}`;

function toRecipeRow(r: RecipeDbRow, standing: Standing): RecipeRow {
  const { team_id: _team, owner_name, parent_code, parent_owner_name, locked, ...rest } = r;
  return {
    ...rest,
    locked: locked === 1,
    owner_name,
    owner_initials: initialsOf(owner_name),
    display_code: displayCode(owner_name, r.code),
    parent_display_code: parent_code && parent_owner_name ? displayCode(parent_owner_name, parent_code) : null,
    elo: Math.round(standing.elo),
    wins: standing.wins,
    losses: standing.losses,
    draws: standing.draws,
    duels: standing.duels,
  };
}

/** Every revealed duel of the team, for Elo replay. */
export async function loadRevealedDuels(db: D1Database, teamId: string): Promise<EloDuel[]> {
  const { results } = await db
    .prepare(
      `SELECT id, recipe_x_id, recipe_y_id, winner_recipe_id, revealed_at, bean_id
         FROM duels WHERE team_id = ? AND status = 'revealed' AND revealed_at IS NOT NULL`,
    )
    .bind(teamId)
    .all<EloDuel>();
  return results;
}

/** Highest Elo first; among equals, the more-duelled and then the newer recipe first. */
function byRank(a: RecipeRow, b: RecipeRow): number {
  return b.elo - a.elo || b.duels - a.duels || b.created_at - a.created_at;
}

/**
 * Team recipes with Elo computed on read. `ownerId` limits to one member's recipes.
 * `beanId` limits to recipes on that bean or duelled on it, rated on that bean's duels only.
 */
export async function listRecipes(
  db: D1Database,
  teamId: string,
  opts: { ownerId?: string; beanId?: string } = {},
): Promise<RecipeRow[]> {
  const where = ['r.team_id = ?'];
  const params: unknown[] = [teamId];
  if (opts.ownerId) {
    where.push('r.owner_member_id = ?');
    params.push(opts.ownerId);
  }
  if (opts.beanId) {
    where.push(`(r.bean_id = ? OR r.id IN (
      SELECT recipe_x_id FROM duels WHERE team_id = ? AND bean_id = ? AND status = 'revealed'
      UNION SELECT recipe_y_id FROM duels WHERE team_id = ? AND bean_id = ? AND status = 'revealed'))`);
    params.push(opts.beanId, teamId, opts.beanId, teamId, opts.beanId);
  }
  const [{ results }, duels] = await Promise.all([
    db
      .prepare(`${RECIPE_SELECT} WHERE ${where.join(' AND ')}`)
      .bind(...params)
      .all<RecipeDbRow>(),
    loadRevealedDuels(db, teamId),
  ]);
  const table = replayElo(duels, { beanId: opts.beanId ?? null });
  return results.map((r) => toRecipeRow(r, table.get(r.id) ?? newStanding())).sort(byRank);
}

/** One recipe of the team with its overall standing, or 404. */
export async function getRecipeRow(db: D1Database, teamId: string, id: string): Promise<RecipeRow> {
  const [row, duels] = await Promise.all([
    db.prepare(`${RECIPE_SELECT} WHERE r.id = ? AND r.team_id = ?`).bind(id, teamId).first<RecipeDbRow>(),
    loadRevealedDuels(db, teamId),
  ]);
  if (!row) throw notFound('recipe');
  return toRecipeRow(row, replayElo(duels).get(row.id) ?? newStanding());
}

type BrewDbRow = Omit<BrewRow, 'member_initials'>;

const BREW_SELECT = `
  SELECT w.id, w.recipe_id, w.member_id, m.name AS member_name, w.bean_id, b.name AS bean_name,
         w.grind_used, w.total_time_s, w.tds_pct, w.beverage_g, w.ey_pct,
         w.sweetness, w.acidity, w.body, w.clarity, w.finish, w.overall, w.notes, w.ai_read, w.created_at
    FROM brews w
    LEFT JOIN members m ON m.id = w.member_id
    LEFT JOIN beans b ON b.id = w.bean_id`;

const toBrewRow = (w: BrewDbRow): BrewRow => ({ ...w, member_initials: initialsOf(w.member_name ?? '') });

export async function listRecipeBrews(db: D1Database, teamId: string, recipeId: string): Promise<BrewRow[]> {
  const { results } = await db
    .prepare(`${BREW_SELECT} WHERE w.team_id = ? AND w.recipe_id = ? ORDER BY w.created_at DESC LIMIT 200`)
    .bind(teamId, recipeId)
    .all<BrewDbRow>();
  return results.map(toBrewRow);
}

export async function getBrewRow(db: D1Database, teamId: string, id: string): Promise<BrewRow> {
  const row = await db.prepare(`${BREW_SELECT} WHERE w.id = ? AND w.team_id = ?`).bind(id, teamId).first<BrewDbRow>();
  if (!row) throw notFound('brew');
  return toBrewRow(row);
}

const round2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);

export async function recipeBrewAverages(db: D1Database, teamId: string, recipeId: string): Promise<BrewAverages> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count, AVG(sweetness) AS sweetness, AVG(acidity) AS acidity, AVG(body) AS body,
              AVG(clarity) AS clarity, AVG(finish) AS finish, AVG(overall) AS overall,
              AVG(tds_pct) AS tds_pct, AVG(ey_pct) AS ey_pct
         FROM brews WHERE team_id = ? AND recipe_id = ?`,
    )
    .bind(teamId, recipeId)
    .first<BrewAverages>();
  if (!row) return { count: 0, sweetness: null, acidity: null, body: null, clarity: null, finish: null, overall: null, tds_pct: null, ey_pct: null };
  return {
    count: row.count,
    sweetness: round2(row.sweetness),
    acidity: round2(row.acidity),
    body: round2(row.body),
    clarity: round2(row.clarity),
    finish: round2(row.finish),
    overall: round2(row.overall),
    tds_pct: round2(row.tds_pct),
    ey_pct: round2(row.ey_pct),
  };
}

/** Highest R-number among a member's codes. */
export function maxCodeNumber(codes: Iterable<string>): number {
  let max = 0;
  for (const code of codes) {
    const m = /^R(\d+)$/.exec(code);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

export async function memberCodes(db: D1Database, memberId: string): Promise<Set<string>> {
  const { results } = await db.prepare('SELECT code FROM recipes WHERE owner_member_id = ?').bind(memberId).all<{ code: string }>();
  return new Set(results.map((r) => r.code));
}

/** Make sure a referenced bean belongs to the team. */
export async function assertTeamBean(db: D1Database, teamId: string, beanId: string | null | undefined): Promise<void> {
  if (!beanId) return;
  const row = await db.prepare('SELECT 1 AS ok FROM beans WHERE id = ? AND team_id = ?').bind(beanId, teamId).first();
  if (!row) throw new ApiError(400, 'bean_not_found', 'That bean no longer exists. Pick another bean.', { field: 'bean_id' });
}
