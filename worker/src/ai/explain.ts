// The coach's explanations the team keeps, in ai_reads: two recipes compared (ours or World
// champions'), and a champion recipe broken down. Each is written once for the whole team and
// written again only when someone asks ("Explain again").
import { CHAMPION_RECIPES, type ChampionRecipe, type ChampionSetup } from '../../../shared/champions';
import { type Orientation, type Sided, compareKey, orient, refKey } from '../../../shared/compare';
import { brewRatio } from '../../../shared/formulas';
import { planBrew } from '../../../shared/phases';
import type { ChampionBreakdown, ChampionBreakdownResponse, CompareRead, CompareRef, CompareResponse, RecipeRow, SavedRead } from '../../../shared/types';
import { championBreakdownOutput, compareOutput } from '../../../shared/schemas';
import { notFound } from '../lib/errors';
import { listRecipes, recipeBrewAverages } from '../lib/recipes';
import { type AiScope, askJson, requireAi } from './client';
import { recipeForCoach, teamSnapshot } from './context';
import { COACH_SYSTEM, championPrompt, comparePrompt, teamBlock } from './prompts';

// ---------- Kept explanations: one row per subject, claimed while it's being written ----------

/** An explanation being written is claimed as `pending:<ms>` first, so a second phone waits. */
const PENDING = 'pending:';
/** Longer than the slowest write (a call and its one retry); an older claim was abandoned. */
const CLAIM_MS = 6 * 60_000;

/** A request to write one: `refresh` writes it again; `seen` is when the one the phone shows was written. */
export interface Ask {
  refresh: boolean;
  seen: number | null;
}

interface ReadRow {
  result_json: string | null;
  result_at: number | null;
  claim: string | null;
}

const readRow = (db: D1Database, teamId: string, key: string) =>
  db.prepare('SELECT result_json, result_at, claim FROM ai_reads WHERE team_id = ? AND id = ?').bind(teamId, key).first<ReadRow>();

const claimFresh = (claim: string | null, now: number) => claim !== null && now - Number(claim.slice(PENDING.length)) < CLAIM_MS;

/** `editedAt`: the latest edit of a team recipe in it, which makes an older explanation stale. */
function saved<T>(scope: AiScope, row: ReadRow | null, editedAt: number | null, now = Date.now()): SavedRead<T> {
  const read = row?.result_json ? (JSON.parse(row.result_json) as T) : null;
  const at = row?.result_at ?? null;
  return {
    read,
    at,
    pending: claimFresh(row?.claim ?? null, now),
    stale: read !== null && at !== null && editedAt !== null && editedAt > at,
    configured: scope.ai !== null,
  };
}

/**
 * Write an explanation unless another phone is writing it right now. Without `refresh`, one
 * already kept is returned as it is. The claim is a conditional write on the row exactly as it
 * was read, so two phones asking at the same moment never both pay.
 */
async function writeSaved<T>(
  scope: AiScope,
  key: string,
  kind: 'compare' | 'champion',
  ask: Ask,
  editedAt: number | null,
  write: () => Promise<T>,
  keepAlive: (work: Promise<unknown>) => void,
): Promise<SavedRead<T>> {
  const db = scope.db;
  const team = scope.member.team_id;
  const row = await readRow(db, team, key);
  const now = Date.now();
  const current = saved<T>(scope, row, editedAt, now);
  if (current.pending || (current.read && !ask.refresh)) return current;
  // Someone wrote a newer one since this phone looked: show that rather than pay again.
  if (current.read && ask.seen !== null && current.at !== ask.seen) return current;
  requireAi(scope);

  const marker = `${PENDING}${now}`;
  const claim = row
    ? await db
        .prepare('UPDATE ai_reads SET claim = ? WHERE team_id = ? AND id = ? AND claim IS ? AND result_at IS ?')
        .bind(marker, team, key, row.claim, row.result_at)
        .run()
    : await db
        .prepare('INSERT OR IGNORE INTO ai_reads (team_id, id, kind, claim, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(team, key, kind, marker, now)
        .run();
  // Another phone got there first: show what it did (its explanation, or that it's writing it).
  if (claim.meta.changes === 0) return saved<T>(scope, await readRow(db, team, key), editedAt);

  const work = (async () => {
    try {
      const read = await write();
      // Dated when the coach started reading, so an edit made while it wrote marks it stale.
      const at = now;
      // Saved only while the claim holds; if another phone took over a stale claim, its read stands.
      await db
        .prepare('UPDATE ai_reads SET result_json = ?, result_at = ?, member_id = ?, claim = NULL WHERE team_id = ? AND id = ? AND claim = ?')
        .bind(JSON.stringify(read), at, scope.member.id, team, key, marker)
        .run();
      return { read, at };
    } catch (err) {
      // Free the claim so the next tap can try again.
      await db
        .prepare('UPDATE ai_reads SET claim = NULL WHERE team_id = ? AND id = ? AND claim = ?')
        .bind(team, key, marker)
        .run()
        .catch(() => undefined);
      throw err;
    }
  })();
  // If the phone closes mid-answer, the Worker still finishes and keeps what it paid for.
  keepAlive(work.catch(() => undefined));
  const { read, at } = await work;
  return { read, at, pending: false, stale: false, configured: true };
}

// ---------- Champion recipes ----------

type PublishedChampion = ChampionRecipe & { recipe: ChampionSetup };

const PLACES = ['', '1st', '2nd', '3rd'];

/** A champion recipe with a published setup, or 404. */
function champion(id: string): PublishedChampion {
  const entry = CHAMPION_RECIPES.find((e) => e.id === id);
  if (!entry?.recipe) throw notFound('champion recipe');
  return entry as PublishedChampion;
}

const championCode = (e: ChampionRecipe) => `WAC ${e.year} ${PLACES[e.place] ?? e.place}`;

const r2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);

/** A champion recipe as the coach sees it: the settings, the method as published, the notes. */
function championForCoach(e: PublishedChampion) {
  const r = e.recipe;
  const plan = planBrew(r);
  return {
    code: championCode(e),
    champion: e.name,
    country: e.country,
    year: e.year,
    place: e.place,
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
    planned_total_s: plan.missing.length === 0 ? plan.total : null,
    method_as_published: r.other_steps,
    notes: e.notes,
    caveats: e.caveats,
  };
}

export async function championState(scope: AiScope, id: string): Promise<ChampionBreakdownResponse> {
  champion(id);
  return saved<ChampionBreakdown>(scope, await readRow(scope.db, scope.member.team_id, `champion:${id}`), null);
}

/** The idea behind a champion's recipe, each choice explained simply, and what the team can take. */
export async function writeChampionBreakdown(
  scope: AiScope,
  id: string,
  ask: Ask,
  keepAlive: (work: Promise<unknown>) => void,
): Promise<ChampionBreakdownResponse> {
  const entry = champion(id);
  return writeSaved<ChampionBreakdown>(
    scope,
    `champion:${id}`,
    'champion',
    ask,
    null,
    async () => {
      const snap = await teamSnapshot(scope.db, scope.member.team_id);
      const team = { competition: snap.team.competition, best_recipes: snap.team.top_recipes.slice(0, 3) };
      return askJson(scope, 'championRead', championBreakdownOutput, COACH_SYSTEM, `${teamBlock(team)}\n\n${championPrompt(championForCoach(entry))}`);
    },
    keepAlive,
  );
}

// ---------- Two recipes compared ----------

/**
 * Both sides exist (a team recipe of this team, or a published champion recipe), or 404. Returns
 * the latest edit among the team recipes, which makes an older explanation stale.
 */
async function checkSides(db: D1Database, teamId: string, refs: CompareRef[]): Promise<number | null> {
  for (const ref of refs) if (ref.kind === 'champion') champion(ref.id);
  const ids = [...new Set(refs.filter((r) => r.kind === 'recipe').map((r) => r.id))];
  if (ids.length === 0) return null;
  const { results } = await db
    .prepare(`SELECT id, updated_at FROM recipes WHERE team_id = ? AND id IN (${ids.map(() => '?').join(', ')})`)
    .bind(teamId, ...ids)
    .all<{ id: string; updated_at: number }>();
  if (results.length !== ids.length) throw notFound('recipe');
  return Math.max(...results.map((r) => r.updated_at));
}

export async function compareState(scope: AiScope, a: CompareRef, b: CompareRef): Promise<CompareResponse> {
  const editedAt = await checkSides(scope.db, scope.member.team_id, [a, b]);
  return saved<CompareRead>(scope, await readRow(scope.db, scope.member.team_id, compareKey(a, b)), editedAt);
}

/** The settings two recipes may differ in, as the coach sees them. */
const COMPARED = [
  'method',
  'filter',
  'dose_g',
  'water_g',
  'ratio',
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
  'planned_total_s',
] as const;

type Compared = Record<(typeof COMPARED)[number], unknown> & { code: string };

const comparable = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : (v ?? null));

interface Side {
  ref: CompareRef;
  sided: Sided;
  code: string;
  forCoach: () => Promise<Compared & Record<string, unknown>>;
}

function sideOf(db: D1Database, teamId: string, ref: CompareRef, recipes: RecipeRow[]): Side {
  if (ref.kind === 'champion') {
    const entry = champion(ref.id);
    return {
      ref,
      sided: { kind: 'champion', id: entry.id, year: entry.year, place: entry.place },
      code: championCode(entry),
      forCoach: async () => championForCoach(entry),
    };
  }
  const recipe = recipes.find((r) => r.id === ref.id);
  if (!recipe) throw notFound('recipe');
  return {
    ref,
    sided: { kind: 'recipe', id: recipe.id, parent_id: recipe.parent_id, created_at: recipe.created_at },
    code: recipe.display_code,
    forCoach: async () => recipeForCoach(recipe, await recipeBrewAverages(db, teamId, recipe.id)),
  };
}

/** How the two team recipes did against each other in revealed recipe duels. */
async function headToHead(db: D1Database, teamId: string, first: string, second: string) {
  const { results } = await db
    .prepare(
      `SELECT winner_recipe_id AS winner, COUNT(*) AS n FROM duels
        WHERE team_id = ? AND status = 'revealed' AND barista_x_id IS NULL
          AND ((recipe_x_id = ? AND recipe_y_id = ?) OR (recipe_x_id = ? AND recipe_y_id = ?))
        GROUP BY winner_recipe_id`,
    )
    .bind(teamId, first, second, second, first)
    .all<{ winner: string | null; n: number }>();
  const won = (id: string | null) => results.find((r) => r.winner === id)?.n ?? 0;
  return { duels: results.reduce((sum, r) => sum + r.n, 0), first_won: won(first), second_won: won(second), draws: won(null) };
}

function relation(o: Orientation, first: string, second: string): string {
  switch (o.framing) {
    case 'versions':
      return o.steps === 1 ? `${second} was cloned from ${first}: it is the newer version.` : `${second} descends from ${first}, ${o.steps} versions later.`;
    case 'recipes':
      return `Two separate team recipes; ${first} is the older one.`;
    case 'champion_ours':
      return `${first} is a World AeroPress Championship podium recipe; ${second} is the team's own.`;
    case 'champions':
      return `Both are World AeroPress Championship podium recipes; ${first} is the earlier one.`;
  }
}

/**
 * Explain two recipes' differences simply: for each one, why you'd do it, how it works and what
 * you'd taste, with the older (or the champion's) recipe first.
 */
export async function writeCompare(
  scope: AiScope,
  a: CompareRef,
  b: CompareRef,
  ask: Ask,
  keepAlive: (work: Promise<unknown>) => void,
): Promise<CompareResponse> {
  const db = scope.db;
  const team = scope.member.team_id;
  const editedAt = await checkSides(db, team, [a, b]);
  return writeSaved<CompareRead>(
    scope,
    compareKey(a, b),
    'compare',
    ask,
    editedAt,
    async () => {
      const recipes = a.kind === 'recipe' || b.kind === 'recipe' ? await listRecipes(db, team) : [];
      const parentOf = (id: string) => recipes.find((r) => r.id === id)?.parent_id ?? null;
      const sides = [sideOf(db, team, a, recipes), sideOf(db, team, b, recipes)] as const;
      const o = orient(sides[0].sided, sides[1].sided, parentOf);
      const [first, second] = o.first === 0 ? sides : [sides[1], sides[0]];
      const [one, two, record] = await Promise.all([
        first.forCoach(),
        second.forCoach(),
        first.ref.kind === 'recipe' && second.ref.kind === 'recipe' ? headToHead(db, team, first.ref.id, second.ref.id) : null,
      ]);
      const keys: string[] = [...COMPARED, ...(o.framing === 'versions' || o.framing === 'recipes' ? ['bean'] : [])];
      const differences = keys
        .filter((k) => comparable(one[k]) !== comparable(two[k]))
        .map((k) => ({ setting: k, first: one[k] ?? null, second: two[k] ?? null }));
      const pair = {
        relation: relation(o, first.code, second.code),
        first: one,
        second: two,
        differences,
        ...(record ? { head_to_head: record } : {}),
      };
      const out = await askJson(scope, 'compare', compareOutput, COACH_SYSTEM, comparePrompt(o.framing, pair));
      return { first: refKey(first.ref), ...out };
    },
    keepAlive,
  );
}
