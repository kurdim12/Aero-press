// The context pack every coach call gets: the team's data as compact JSON, built from D1 on the
// server. Capped at ~40 recent brews and duels for the asking member, plus the team's top recipes.
import type { RecipeRow } from '../../../shared/types';
import { brewRatio, daysOffRoast } from '../../../shared/formulas';
import { planBrew } from '../../../shared/phases';
import type { AuthMember } from '../env';
import { listRecipes } from '../lib/recipes';
import { TEAM_UTC_OFFSET_MS, localDay } from './config';

const RECENT_LIMIT = 40;
const TEAM_TOP = 15;
const MAX_RECIPES = 30;

const r2 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100) / 100);

interface AverageRow {
  recipe_id: string;
  count: number;
  sweetness: number | null;
  acidity: number | null;
  body: number | null;
  clarity: number | null;
  finish: number | null;
  overall: number | null;
  tds_pct: number | null;
  ey_pct: number | null;
}

interface BeanDbRow {
  id: string;
  name: string;
  roaster: string | null;
  origin: string | null;
  variety: string | null;
  process: string | null;
  roast_level: string | null;
  roast_date: string | null;
  altitude: string | null;
  density_notes: string | null;
  notes: string | null;
  is_competition_coffee: number;
}

interface BrewDbRow {
  created_at: number;
  recipe_id: string | null;
  bean_name: string | null;
  grind_used: string | null;
  total_time_s: number | null;
  tds_pct: number | null;
  beverage_g: number | null;
  ey_pct: number | null;
  sweetness: number | null;
  acidity: number | null;
  body: number | null;
  clarity: number | null;
  finish: number | null;
  overall: number | null;
  notes: string | null;
}

interface DuelDbRow {
  revealed_at: number;
  recipe_x_id: string;
  recipe_y_id: string;
  winner_recipe_id: string | null;
  x_votes: number;
  y_votes: number;
  bean_name: string | null;
}

export interface ContextPack {
  today: string;
  asked_by: { name: string; role: string };
  competition: Record<string, unknown>;
  beans: Record<string, unknown>[];
  recipes: Record<string, unknown>[];
  recent_brews: Record<string, unknown>[];
  recent_duels: Record<string, unknown>[];
}

export interface PackData {
  pack: ContextPack;
  /** Every team recipe, for turning codes the coach writes back into ids. */
  recipes: RecipeRow[];
}

const day = (ms: number) => new Date(ms + TEAM_UTC_OFFSET_MS).toISOString().slice(0, 10);

/** The recipe as the coach sees it: every field, ratio, parent code, Elo, record, brew averages. */
export function recipeForCoach(r: RecipeRow, averages?: Omit<AverageRow, 'recipe_id'>) {
  const plan = planBrew(r);
  return {
    code: r.display_code,
    name: r.name,
    owner: r.owner_name,
    parent: r.parent_display_code,
    competition_recipe: r.locked || undefined,
    bean: r.bean_name,
    method: r.method,
    filter: r.filter,
    dose_g: r.dose_g,
    water_g: r.water_g,
    ratio: r2(brewRatio(r.water_g, r.dose_g)),
    temp_c: r.temp_c,
    grinder: r.grinder,
    grind_setting: r.grind_setting,
    water_recipe: r.water_recipe,
    bloom_water_g: r.bloom_water_g,
    bloom_ends_s: r.bloom_ends_s,
    agitation: r.agitation,
    press_starts_s: r.press_starts_s,
    press_duration_s: r.press_duration_s,
    bypass_g: r.bypass_g,
    bypass_temp: r.bypass_temp,
    other_steps: r.other_steps,
    notes: r.notes,
    planned_total_s: plan.missing.length === 0 ? plan.total : null,
    elo: r.elo,
    record: `${r.wins}-${r.losses}-${r.draws}`,
    brews: averages?.count ?? 0,
    averages: averages?.count
      ? {
          sweetness: r2(averages.sweetness),
          acidity: r2(averages.acidity),
          body: r2(averages.body),
          clarity: r2(averages.clarity),
          finish: r2(averages.finish),
          overall: r2(averages.overall),
          tds_pct: r2(averages.tds_pct),
          ey_pct: r2(averages.ey_pct),
        }
      : null,
  };
}

/**
 * Build the pack. `recipeLimit` trims it for light calls (today's card). The member's own recipes
 * come first, then the team's best by Elo.
 */
export async function buildContextPack(db: D1Database, me: AuthMember, opts: { recipeLimit?: number } = {}): Promise<PackData> {
  const now = Date.now();
  const [team, beans, recipes, averages, brews, duels] = await Promise.all([
    db
      .prepare('SELECT name, champ_name, champ_date, comp_coffee_notes FROM teams WHERE id = ?')
      .bind(me.team_id)
      .first<{ name: string; champ_name: string | null; champ_date: string | null; comp_coffee_notes: string | null }>(),
    db
      .prepare(
        `SELECT id, name, roaster, origin, variety, process, roast_level, roast_date, altitude, density_notes, notes, is_competition_coffee
           FROM beans WHERE team_id = ? ORDER BY is_competition_coffee DESC, updated_at DESC LIMIT 40`,
      )
      .bind(me.team_id)
      .all<BeanDbRow>(),
    listRecipes(db, me.team_id),
    db
      .prepare(
        `SELECT recipe_id, COUNT(*) AS count, AVG(sweetness) AS sweetness, AVG(acidity) AS acidity, AVG(body) AS body,
                AVG(clarity) AS clarity, AVG(finish) AS finish, AVG(overall) AS overall, AVG(tds_pct) AS tds_pct, AVG(ey_pct) AS ey_pct
           FROM brews WHERE team_id = ? AND recipe_id IS NOT NULL GROUP BY recipe_id`,
      )
      .bind(me.team_id)
      .all<AverageRow>(),
    db
      .prepare(
        `SELECT w.created_at, w.recipe_id, b.name AS bean_name, w.grind_used, w.total_time_s, w.tds_pct, w.beverage_g, w.ey_pct,
                w.sweetness, w.acidity, w.body, w.clarity, w.finish, w.overall, w.notes
           FROM brews w LEFT JOIN beans b ON b.id = w.bean_id
          WHERE w.team_id = ? AND w.member_id = ? ORDER BY w.created_at DESC LIMIT ?`,
      )
      .bind(me.team_id, me.id, RECENT_LIMIT)
      .all<BrewDbRow>(),
    db
      .prepare(
        `SELECT d.revealed_at, d.recipe_x_id, d.recipe_y_id, d.winner_recipe_id, d.x_votes, d.y_votes, b.name AS bean_name
           FROM duels d LEFT JOIN beans b ON b.id = d.bean_id
          WHERE d.team_id = ? AND d.status = 'revealed' AND d.revealed_at IS NOT NULL
            AND (d.created_by = ? OR EXISTS (
                  SELECT 1 FROM recipes r WHERE r.id IN (d.recipe_x_id, d.recipe_y_id) AND r.owner_member_id = ?))
          ORDER BY d.revealed_at DESC LIMIT ?`,
      )
      .bind(me.team_id, me.id, me.id, RECENT_LIMIT)
      .all<DuelDbRow>(),
  ]);

  const averagesById = new Map(averages.results.map((a) => [a.recipe_id, a]));
  const codeById = new Map(recipes.map((r) => [r.id, r.display_code]));
  const limit = opts.recipeLimit ?? MAX_RECIPES;
  const mine = recipes.filter((r) => r.owner_member_id === me.id);
  const top = recipes.slice(0, TEAM_TOP);
  const chosen: RecipeRow[] = [];
  for (const r of [...recipes.filter((x) => x.locked), ...top, ...mine]) {
    if (chosen.length >= limit) break;
    if (!chosen.includes(r)) chosen.push(r);
  }
  const compBean = beans.results.find((b) => b.is_competition_coffee === 1);
  const daysToGo = team?.champ_date ? Math.ceil((Date.parse(`${team.champ_date}T00:00:00+03:00`) - now) / 86_400_000) : null;

  const pack: ContextPack = {
    today: localDay(now),
    asked_by: { name: me.name, role: me.role },
    competition: {
      team: team?.name ?? null,
      championship: team?.champ_name ?? null,
      date: team?.champ_date ?? null,
      days_to_go: daysToGo,
      competition_coffee: compBean?.name ?? null,
      competition_coffee_notes: team?.comp_coffee_notes ?? null,
    },
    beans: beans.results.map((b) => ({
      name: b.name,
      roaster: b.roaster,
      origin: b.origin,
      variety: b.variety,
      process: b.process,
      roast_level: b.roast_level,
      roast_date: b.roast_date,
      days_off_roast: daysOffRoast(b.roast_date, new Date(now)),
      altitude: b.altitude,
      density_notes: b.density_notes,
      notes: b.notes,
      competition_coffee: b.is_competition_coffee === 1 || undefined,
    })),
    recipes: chosen.map((r) => recipeForCoach(r, averagesById.get(r.id))),
    recent_brews: brews.results.map((w) => ({
      day: day(w.created_at),
      recipe: w.recipe_id ? (codeById.get(w.recipe_id) ?? null) : null,
      bean: w.bean_name,
      grind_used: w.grind_used,
      total_time_s: w.total_time_s,
      tds_pct: w.tds_pct,
      beverage_g: w.beverage_g,
      ey_pct: w.ey_pct,
      sweetness: w.sweetness,
      acidity: w.acidity,
      body: w.body,
      clarity: w.clarity,
      finish: w.finish,
      overall: w.overall,
      notes: w.notes,
    })),
    recent_duels: duels.results.map((d) => ({
      day: day(d.revealed_at),
      x: codeById.get(d.recipe_x_id) ?? null,
      y: codeById.get(d.recipe_y_id) ?? null,
      winner: d.winner_recipe_id ? (codeById.get(d.winner_recipe_id) ?? null) : 'draw',
      votes: `${d.x_votes}-${d.y_votes}`,
      bean: d.bean_name,
    })),
  };
  return { pack, recipes };
}

/** A recipe code the coach wrote ("AK-R3", "ak-r3", or a bare "R3" if only one matches) → recipe. */
export function findRecipeByCode(recipes: RecipeRow[], code: string | null | undefined): RecipeRow | null {
  if (!code) return null;
  const wanted = code.trim().toUpperCase();
  const exact = recipes.find((r) => r.display_code.toUpperCase() === wanted);
  if (exact) return exact;
  const bare = recipes.filter((r) => r.code.toUpperCase() === wanted);
  return bare.length === 1 ? (bare[0] ?? null) : null;
}
