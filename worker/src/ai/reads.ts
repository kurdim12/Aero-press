// The short reads the coach writes on its own: after a brew (Haiku) and after a duel (Sonnet).
import { type Criterion, type DuelRead, JUDGING_CRITERIA } from '../../../shared/types';
import { duelReadOutput } from '../../../shared/schemas';
import { type DuelDbRow, winnerSide } from '../lib/duels';
import { listRecipes, recipeBrewAverages } from '../lib/recipes';
import { clipToSentence } from '../lib/text';
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
  const read = clipToSentence(await askText(scope, 'brewRead', BREW_READ_SYSTEM, brewReadUser(data)), BREW_READ_MAX);
  if (read) await db.prepare('UPDATE brews SET ai_read = ? WHERE id = ? AND team_id = ?').bind(read, brewId, team).run();
}

/** Longest brew read kept (the card under a brew shows two sentences). */
const BREW_READ_MAX = 600;

/**
 * What the duel result suggests and one next test. Saved on the duel as JSON, but only while
 * `claim` (the caller's pending marker) still holds; if another phone took over a stale claim,
 * its read stands and this one is returned without being saved.
 */
export async function writeDuelRead(scope: AiScope, duel: DuelDbRow, claim: string): Promise<DuelRead> {
  const db = scope.db;
  const team = scope.member.team_id;
  const [recipes, avgX, avgY, beans, scores] = await Promise.all([
    listRecipes(db, team),
    recipeBrewAverages(db, team, duel.recipe_x_id),
    recipeBrewAverages(db, team, duel.recipe_y_id),
    db.prepare('SELECT id, name FROM beans WHERE team_id = ?').bind(team).all<{ id: string; name: string }>(),
    db
      .prepare(
        `SELECT cup, ${JUDGING_CRITERIA.map((k) => `ROUND(AVG(${k}), 1) AS ${k}`).join(', ')}
           FROM duel_scores WHERE duel_id = ? GROUP BY cup`,
      )
      .bind(duel.id)
      .all<{ cup: 'x' | 'y' } & Record<Criterion, number>>(),
  ]);
  const x = recipes.find((r) => r.id === duel.recipe_x_id);
  const y = recipes.find((r) => r.id === duel.recipe_y_id);
  if (!x || !y) throw new Error('duel recipes missing');
  const baristas = duel.barista_x_name && duel.barista_y_name ? { x: duel.barista_x_name, y: duel.barista_y_name } : null;
  const side = winnerSide(duel);
  const winner = side === null ? 'draw' : baristas ? `${baristas[side]} (${(side === 'x' ? x : y).display_code})` : (side === 'x' ? x : y).display_code;
  const judged = (cup: 'x' | 'y') => {
    const row = scores.results.find((r) => r.cup === cup);
    return row ? Object.fromEntries(JUDGING_CRITERIA.map((k) => [k, row[k]])) : null;
  };
  const summary = {
    kind: baristas ? 'barista duel: two teammates, each brewing their own recipe' : 'recipe duel: one person poured both cups',
    bean: duel.bean_name,
    cup_x: { ...(baristas ? { brewed_by: baristas.x } : {}), judges_average_scores: judged('x'), recipe: recipeForCoach(x, avgX) },
    cup_y: { ...(baristas ? { brewed_by: baristas.y } : {}), judges_average_scores: judged('y'), recipe: recipeForCoach(y, avgY) },
    winner,
    votes: { x: duel.x_votes, y: duel.y_votes, judges: duel.judge_count },
    note: baristas ? 'Barista duels rank the baristas; recipe Elo is unchanged.' : 'Elo and records already include this duel.',
  };
  const out = await askJson(scope, 'duelRead', duelReadOutput, COACH_SYSTEM, duelReadPrompt(summary));
  const read: DuelRead = { read: out.read, next_test: out.next_test ? toExperiment(out.next_test, recipes, beans.results) : null };
  await db
    .prepare('UPDATE duels SET ai_read = ? WHERE id = ? AND team_id = ? AND ai_read = ?')
    .bind(JSON.stringify(read), duel.id, team, claim)
    .run();
  return read;
}

