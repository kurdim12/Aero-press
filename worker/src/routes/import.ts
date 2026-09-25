import { Hono } from 'hono';
import type { AppEnv, AuthMember } from '../env';
import type { ImportKind, ImportResult, ImportWarning } from '../../../shared/types';
import {
  importRequest,
  type ImportBean,
  type ImportBrew,
  type ImportDuel,
  type ImportRecipe,
  type ImportSettings,
} from '../../../shared/schemas';
import { extractionYield } from '../../../shared/formulas';
import { requireMember, requireOwner } from '../middleware/auth';
import { maxCodeNumber, memberCodes } from '../lib/recipes';
import { existingIds, insertJsonRows } from '../lib/sql';
import { readJson } from '../lib/validate';

// Owner-only import of a v1 backup. The browser maps the file (shared/v1import.ts) and
// sends it in chunks: beans, then recipes (parents first), brews, duels and settings.
// IDs are preserved and existing IDs are skipped, so importing twice is safe.
// Everything imported belongs to the owner.
export const importRoutes = new Hono<AppEnv>();
importRoutes.use('*', requireMember, requireOwner);

class Warnings {
  private items = new Map<string, { count: number; examples: string[] }>();

  add(code: string, example?: string): void {
    const item = this.items.get(code) ?? { count: 0, examples: [] };
    item.count++;
    if (example && item.examples.length < 5) item.examples.push(example);
    this.items.set(code, item);
  }

  list(message: (code: string, count: number, examples: string[]) => string): ImportWarning[] {
    return [...this.items].map(([code, { count, examples }]) => ({ code, count, examples, message: message(code, count, examples) }));
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function result(kind: ImportKind, inserted: number, alreadyThere: number, skipped: number, warnings: ImportWarning[]): ImportResult {
  return { kind, inserted, already_there: alreadyThere, skipped, warnings };
}

// ---------- Beans ----------

const BEAN_COLUMNS = [
  'id', 'name', 'roaster', 'origin', 'variety', 'process', 'roast_level', 'roast_date', 'altitude',
  'density_notes', 'notes', 'is_competition_coffee', 'created_at', 'updated_at',
] as const;

async function importBeans(db: D1Database, me: AuthMember, records: ImportBean[]): Promise<ImportResult> {
  const warnings = new Warnings();
  const existing = await existingIds(db, 'beans', records.map((r) => r.id));
  const fresh = records.filter((r) => !existing.has(r.id));

  // At most one competition coffee: an existing marker wins, then the first in the file.
  const hasComp = await db
    .prepare('SELECT 1 AS ok FROM beans WHERE team_id = ? AND is_competition_coffee = 1')
    .bind(me.team_id)
    .first();
  let compTaken = hasComp !== null;
  const rows = fresh.map((r) => {
    if (!r.is_competition_coffee) return r;
    if (compTaken) {
      warnings.add('extra_competition_coffee', r.name);
      return { ...r, is_competition_coffee: false };
    }
    compTaken = true;
    return r;
  });

  const inserted = rows.length
    ? (await insertJsonRows(db, 'beans', { team_id: me.team_id, created_by: me.id }, BEAN_COLUMNS, rows).run()).meta.changes
    : 0;
  return result(
    'beans',
    inserted,
    existing.size,
    rows.length - inserted,
    warnings.list((_code, n, examples) =>
      `${plural(n, 'bean was', 'beans were')} also marked as the competition coffee (${examples.join(', ')}). Only one can be; the marker stayed where it was.`,
    ),
  );
}

// ---------- Recipes ----------

const RECIPE_COLUMNS = [
  'id', 'code', 'name', 'parent_id', 'bean_id', 'method', 'filter', 'dose_g', 'water_g', 'temp_c', 'grinder',
  'grind_setting', 'water_recipe', 'bloom_water_g', 'bloom_ends_s', 'agitation', 'press_starts_s',
  'press_duration_s', 'bypass_g', 'bypass_temp', 'other_steps', 'notes', 'locked', 'created_at', 'updated_at',
] as const;

async function importRecipes(db: D1Database, me: AuthMember, records: ImportRecipe[]): Promise<ImportResult> {
  const warnings = new Warnings();
  const existing = await existingIds(db, 'recipes', records.map((r) => r.id));
  const fresh = records.filter((r) => !existing.has(r.id));

  const [beans, parents, codes, lockedRow] = await Promise.all([
    existingIds(db, 'beans', fresh.flatMap((r) => (r.bean_id ? [r.bean_id] : [])), me.team_id),
    existingIds(db, 'recipes', fresh.flatMap((r) => (r.parent_id ? [r.parent_id] : [])), me.team_id),
    memberCodes(db, me.id),
    db.prepare('SELECT 1 AS ok FROM recipes WHERE team_id = ? AND locked = 1').bind(me.team_id).first(),
  ]);
  const inChunk = new Set(fresh.map((r) => r.id));
  let nextCode = maxCodeNumber([...codes, ...fresh.flatMap((r) => (r.code ? [r.code] : []))]);
  let lockTaken = lockedRow !== null;

  const rows = fresh.map((r) => {
    const row = { ...r };
    if (row.bean_id && !beans.has(row.bean_id)) {
      warnings.add('bean_missing');
      row.bean_id = null;
    }
    if (row.parent_id && !parents.has(row.parent_id) && !inChunk.has(row.parent_id)) {
      warnings.add('parent_missing');
      row.parent_id = null;
    }
    if (!row.code || codes.has(row.code)) {
      const code = `R${++nextCode}`;
      if (row.code) warnings.add('code_renamed', `${row.code} → ${code}`);
      row.code = code;
    }
    codes.add(row.code);
    if (row.locked) {
      if (lockTaken) {
        warnings.add('extra_lock');
        row.locked = false;
      }
      lockTaken = true;
    }
    return row;
  });

  const inserted = rows.length
    ? (await insertJsonRows(db, 'recipes', { team_id: me.team_id, owner_member_id: me.id }, RECIPE_COLUMNS, rows).run()).meta.changes
    : 0;
  return result(
    'recipes',
    inserted,
    existing.size,
    rows.length - inserted,
    warnings.list((code, n, examples) => {
      switch (code) {
        case 'bean_missing':
          return `${plural(n, 'recipe points', 'recipes point')} to a bean that isn’t in the backup, so ${n === 1 ? 'it has' : 'they have'} no bean now.`;
        case 'parent_missing':
          return `${plural(n, 'recipe was', 'recipes were')} cloned from a recipe that isn’t in the backup, so ${n === 1 ? 'it starts' : 'they start'} a new lineage.`;
        case 'code_renamed':
          return `${plural(n, 'recipe code was', 'recipe codes were')} already in use and got the next free number (${examples.join(', ')}).`;
        default:
          return `${plural(n, 'more recipe was', 'more recipes were')} marked as the competition recipe. Only one can be locked, so ${n === 1 ? 'it was' : 'they were'} left unlocked.`;
      }
    }),
  );
}

// ---------- Brews ----------

const BREW_COLUMNS = [
  'id', 'recipe_id', 'bean_id', 'grind_used', 'total_time_s', 'tds_pct', 'beverage_g', 'ey_pct', 'sweetness',
  'acidity', 'body', 'clarity', 'finish', 'overall', 'notes', 'created_at',
] as const;

async function importBrews(db: D1Database, me: AuthMember, records: ImportBrew[]): Promise<ImportResult> {
  const warnings = new Warnings();
  const existing = await existingIds(db, 'brews', records.map((r) => r.id));
  const fresh = records.filter((r) => !existing.has(r.id));

  const recipeIds = [...new Set(fresh.flatMap((r) => (r.recipe_id ? [r.recipe_id] : [])))];
  const [doses, beans] = await Promise.all([
    recipeIds.length
      ? db
          .prepare('SELECT id, dose_g FROM recipes WHERE team_id = ? AND id IN (SELECT value FROM json_each(?))')
          .bind(me.team_id, JSON.stringify(recipeIds))
          .all<{ id: string; dose_g: number | null }>()
          .then(({ results }) => new Map(results.map((r) => [r.id, r.dose_g])))
      : Promise.resolve(new Map<string, number | null>()),
    existingIds(db, 'beans', fresh.flatMap((r) => (r.bean_id ? [r.bean_id] : [])), me.team_id),
  ]);

  const rows = fresh.map((r) => {
    const row = { ...r };
    if (row.recipe_id && !doses.has(row.recipe_id)) {
      warnings.add('recipe_missing');
      row.recipe_id = null;
    }
    if (row.bean_id && !beans.has(row.bean_id)) {
      warnings.add('bean_missing');
      row.bean_id = null;
    }
    // EY is computed server-side whenever v1 didn't record it.
    if (row.ey_pct === null && row.recipe_id) {
      row.ey_pct = extractionYield(row.tds_pct, row.beverage_g, doses.get(row.recipe_id));
    }
    return row;
  });

  const inserted = rows.length
    ? (await insertJsonRows(db, 'brews', { team_id: me.team_id, member_id: me.id }, BREW_COLUMNS, rows).run()).meta.changes
    : 0;
  return result(
    'brews',
    inserted,
    existing.size,
    rows.length - inserted,
    warnings.list((code, n) =>
      code === 'recipe_missing'
        ? `${plural(n, 'brew belongs', 'brews belong')} to a recipe that isn’t in the backup. ${n === 1 ? 'It was' : 'They were'} kept without a recipe.`
        : `${plural(n, 'brew names', 'brews name')} a bean that isn’t in the backup, so ${n === 1 ? 'it has' : 'they have'} no bean now.`,
    ),
  );
}

// ---------- Duels ----------

const DUEL_COLUMNS = [
  'id', 'recipe_x_id', 'recipe_y_id', 'bean_id', 'judge_count', 'winner_recipe_id', 'x_votes', 'y_votes', 'notes',
  'created_at', 'revealed_at',
] as const;

async function importDuels(db: D1Database, me: AuthMember, records: ImportDuel[]): Promise<ImportResult> {
  const warnings = new Warnings();
  const existing = await existingIds(db, 'duels', records.map((r) => r.id));
  const fresh = records.filter((r) => !existing.has(r.id));

  const [recipes, beans] = await Promise.all([
    existingIds(db, 'recipes', fresh.flatMap((r) => [r.recipe_x_id, r.recipe_y_id]), me.team_id),
    existingIds(db, 'beans', fresh.flatMap((r) => (r.bean_id ? [r.bean_id] : [])), me.team_id),
  ]);

  let skipped = 0;
  const rows: ImportDuel[] = [];
  for (const r of fresh) {
    if (!recipes.has(r.recipe_x_id) || !recipes.has(r.recipe_y_id) || r.recipe_x_id === r.recipe_y_id) {
      warnings.add('recipe_missing');
      skipped++;
      continue;
    }
    if (r.winner_recipe_id !== null && r.winner_recipe_id !== r.recipe_x_id && r.winner_recipe_id !== r.recipe_y_id) {
      warnings.add('bad_winner');
      skipped++;
      continue;
    }
    if (r.bean_id && !beans.has(r.bean_id)) {
      warnings.add('bean_missing');
      rows.push({ ...r, bean_id: null });
    } else rows.push(r);
  }

  const inserted = rows.length
    ? (
        await insertJsonRows(
          db,
          'duels',
          { team_id: me.team_id, created_by: me.id, status: 'revealed' },
          DUEL_COLUMNS,
          rows,
        ).run()
      ).meta.changes
    : 0;
  return result(
    'duels',
    inserted,
    existing.size,
    skipped + rows.length - inserted,
    warnings.list((code, n) => {
      switch (code) {
        case 'recipe_missing':
          return `${plural(n, 'duel', 'duels')} involved a recipe that isn’t in the backup, so ${n === 1 ? 'it was' : 'they were'} left out of the ranking.`;
        case 'bad_winner':
          return `${plural(n, 'duel names', 'duels name')} a winner that wasn’t in the duel, so ${n === 1 ? 'it was' : 'they were'} left out.`;
        default:
          return `${plural(n, 'duel names', 'duels name')} a bean that isn’t in the backup, so ${n === 1 ? 'it has' : 'they have'} no bean now.`;
      }
    }),
  );
}

// ---------- Settings ----------

/** Fill championship details only where the team hasn't set them yet. */
async function importSettings(db: D1Database, me: AuthMember, settings: ImportSettings): Promise<ImportResult> {
  const team = await db
    .prepare('SELECT champ_name, champ_date, comp_coffee_notes FROM teams WHERE id = ?')
    .bind(me.team_id)
    .first<ImportSettings>();
  const fields = ['champ_name', 'champ_date', 'comp_coffee_notes'] as const;
  const toSet = fields.filter((f) => settings[f] !== null && !team?.[f]);
  const alreadySet = fields.filter((f) => settings[f] !== null && team?.[f]).length;
  if (toSet.length) {
    await db
      .prepare(`UPDATE teams SET ${toSet.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`)
      .bind(...toSet.map((f) => settings[f]), me.team_id)
      .run();
  }
  return result('settings', toSet.length, alreadySet, 0, []);
}

importRoutes.post('/v1', async (c) => {
  const body = await readJson(c, importRequest);
  const me = c.get('member');
  const db = c.env.DB;
  switch (body.kind) {
    case 'beans':
      return c.json<ImportResult>(await importBeans(db, me, body.records));
    case 'recipes':
      return c.json<ImportResult>(await importRecipes(db, me, body.records));
    case 'brews':
      return c.json<ImportResult>(await importBrews(db, me, body.records));
    case 'duels':
      return c.json<ImportResult>(await importDuels(db, me, body.records));
    case 'settings':
      return c.json<ImportResult>(await importSettings(db, me, body.settings));
  }
});
