// The short reads the coach writes on its own: after a brew (Haiku) and after a duel (Sonnet).
import type { DuelRead } from '../../../shared/types';
import { duelReadOutput } from '../../../shared/schemas';
import type { DuelDbRow } from '../lib/duels';
import { listRecipes, recipeBrewAverages } from '../lib/recipes';
import { type AiScope, askJson, askText } from './client';
import { recipeForCoach } from './context';
import { toExperiment } from './experiments';
import { BREW_READ_SYSTEM, COACH_SYSTEM, brewReadUser, duelReadPrompt } from './prompts';

interface BrewNumbers {
  created_at: number;
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
  grind_used: string | null;
  notes: string | null;
}

const NUMBERS = `created_at, total_time_s, tds_pct, beverage_g, ey_pct, sweetness, acidity, body, clarity, finish, overall, grind_used, notes`;
const r2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);

/** Two sentences comparing a new brew with its recipe's average and last 5 brews; saved on the brew. */
export async function writeBrewRead(scope: AiScope, brewId: string): Promise<void> {
  const db = scope.db;
  const team = scope.member.team_id;
  const brew = await db
    .prepare(`SELECT recipe_id, ${NUMBERS} FROM brews WHERE id = ? AND team_id = ?`)
    .bind(brewId, team)
    .first<BrewNumbers & { recipe_id: string | null }>();
  if (!brew?.recipe_id) return;
  const [recipe, history, average] = await Promise.all([
    db
      .prepare('SELECT code, name, dose_g, water_g, temp_c, grind_setting FROM recipes WHERE id = ? AND team_id = ?')
      .bind(brew.recipe_id, team)
      .first<{ code: string; name: string | null; dose_g: number | null; water_g: number | null; temp_c: number | null; grind_setting: string | null }>(),
    db
      .prepare(`SELECT ${NUMBERS} FROM brews WHERE team_id = ? AND recipe_id = ? AND id <> ? ORDER BY created_at DESC LIMIT 5`)
      .bind(team, brew.recipe_id, brewId)
      .all<BrewNumbers>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count, AVG(total_time_s) AS total_time_s, AVG(tds_pct) AS tds_pct, AVG(ey_pct) AS ey_pct,
                AVG(sweetness) AS sweetness, AVG(acidity) AS acidity, AVG(body) AS body, AVG(clarity) AS clarity,
                AVG(finish) AS finish, AVG(overall) AS overall
           FROM brews WHERE team_id = ? AND recipe_id = ? AND id <> ?`,
      )
      .bind(team, brew.recipe_id, brewId)
      .first<Record<string, number | null>>(),
  ]);
  if (!recipe) return;
  const strip = ({ created_at: _t, ...rest }: BrewNumbers) => rest;
  const data = {
    recipe,
    this_brew: strip(brew),
    recipe_average_before: average && average.count ? Object.fromEntries(Object.entries(average).map(([k, v]) => [k, r2(v)])) : null,
    last_5_before: history.results.map(strip),
  };
  const read = (await askText(scope, 'brewRead', BREW_READ_SYSTEM, brewReadUser(data))).slice(0, 600);
  if (read) await db.prepare('UPDATE brews SET ai_read = ? WHERE id = ? AND team_id = ?').bind(read, brewId, team).run();
}

/** What the duel result suggests and one next test. Saved on the duel as JSON. */
export async function writeDuelRead(scope: AiScope, duel: DuelDbRow): Promise<DuelRead> {
  const db = scope.db;
  const team = scope.member.team_id;
  const [recipes, avgX, avgY, beans] = await Promise.all([
    listRecipes(db, team),
    recipeBrewAverages(db, team, duel.recipe_x_id),
    recipeBrewAverages(db, team, duel.recipe_y_id),
    db.prepare('SELECT id, name FROM beans WHERE team_id = ?').bind(team).all<{ id: string; name: string }>(),
  ]);
  const x = recipes.find((r) => r.id === duel.recipe_x_id);
  const y = recipes.find((r) => r.id === duel.recipe_y_id);
  if (!x || !y) throw new Error('duel recipes missing');
  const winner = duel.winner_recipe_id === x.id ? x.display_code : duel.winner_recipe_id === y.id ? y.display_code : 'draw';
  const summary = {
    bean: duel.bean_name,
    cup_x: recipeForCoach(x, avgX),
    cup_y: recipeForCoach(y, avgY),
    winner,
    votes: { x: duel.x_votes, y: duel.y_votes, judges: duel.judge_count },
    note: 'Elo and records already include this duel.',
  };
  const out = await askJson(scope, 'duelRead', duelReadOutput, COACH_SYSTEM, duelReadPrompt(summary));
  const read: DuelRead = { read: out.read, next_test: out.next_test ? toExperiment(out.next_test, recipes, beans.results) : null };
  await db.prepare('UPDATE duels SET ai_read = ? WHERE id = ? AND team_id = ?').bind(JSON.stringify(read), duel.id, team).run();
  return read;
}

