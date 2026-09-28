// Blind duels: loading, the per-viewer view, and the reveal.
// What is behind X and Y (the recipes, and in a barista duel who brewed which cup) leaves the
// server only through `toDuelView`, which gives it to the creator (who pours, or hosts and places
// the cups) and, after the reveal, to everyone. Judges never get it before the reveal.
import {
  type CupScores,
  type DuelChoice,
  type DuelJudge,
  type DuelPerson,
  type DuelRead,
  type DuelRecipe,
  type DuelStatus,
  type DuelView,
  JUDGING_CRITERIA,
} from '../../../shared/types';
import { initialsOf } from '../../../shared/initials';
import type { AuthMember } from '../env';
import { notFound } from './errors';
import { displayCode } from './recipes';

export interface DuelDbRow {
  id: string;
  team_id: string;
  recipe_x_id: string;
  recipe_y_id: string;
  bean_id: string | null;
  bean_name: string | null;
  judge_count: number;
  status: DuelStatus;
  winner_recipe_id: string | null;
  x_votes: number;
  y_votes: number;
  notes: string | null;
  ai_read: string | null;
  rematch_of: string | null;
  rematch_id: string | null;
  created_by: string | null;
  creator_name: string | null;
  created_at: number;
  revealed_at: number | null;
  /** Barista duels only: who brewed cup X and cup Y. */
  barista_x_id: string | null;
  barista_x_name: string | null;
  barista_y_id: string | null;
  barista_y_name: string | null;
}

interface JudgeDbRow {
  duel_id: string;
  member_id: string;
  name: string;
  choice: DuelChoice | null;
}

interface RecipeNameRow {
  id: string;
  code: string;
  name: string | null;
  owner_name: string;
}

const DUEL_SELECT = `
  SELECT d.id, d.team_id, d.recipe_x_id, d.recipe_y_id, d.bean_id, b.name AS bean_name, d.judge_count,
         d.status, d.winner_recipe_id, d.x_votes, d.y_votes, d.notes, d.ai_read, d.rematch_of,
         (SELECT r.id FROM duels r WHERE r.rematch_of = d.id ORDER BY r.created_at DESC LIMIT 1) AS rematch_id,
         d.created_by, m.name AS creator_name, d.created_at, d.revealed_at,
         d.barista_x_id, bx.name AS barista_x_name, d.barista_y_id, bw.name AS barista_y_name
    FROM duels d
    LEFT JOIN beans b ON b.id = d.bean_id
    LEFT JOIN members m ON m.id = d.created_by
    LEFT JOIN members bx ON bx.id = d.barista_x_id
    LEFT JOIN members bw ON bw.id = d.barista_y_id`;

export async function getDuelRow(db: D1Database, teamId: string, id: string): Promise<DuelDbRow> {
  const row = await db.prepare(`${DUEL_SELECT} WHERE d.id = ? AND d.team_id = ?`).bind(id, teamId).first<DuelDbRow>();
  if (!row) throw notFound('duel');
  return row;
}

/** Active duels (pouring or judging) and the most recent finished ones. */
export async function listDuelRows(db: D1Database, teamId: string, recentLimit = 20): Promise<DuelDbRow[]> {
  const [active, recent] = await Promise.all([
    db
      .prepare(`${DUEL_SELECT} WHERE d.team_id = ? AND d.status IN ('setup', 'pouring', 'judging') ORDER BY d.created_at DESC`)
      .bind(teamId)
      .all<DuelDbRow>(),
    db
      .prepare(
        `${DUEL_SELECT} WHERE d.team_id = ? AND d.status IN ('revealed', 'cancelled')
          ORDER BY COALESCE(d.revealed_at, d.created_at) DESC LIMIT ?`,
      )
      .bind(teamId, recentLimit)
      .all<DuelDbRow>(),
  ]);
  return [...active.results, ...recent.results];
}

export const isFinished = (status: DuelStatus) => status === 'revealed' || status === 'cancelled';

/** Marks a duel read being written by one phone, so the others wait instead of paying twice. */
export const READ_PENDING = 'pending:';

/** ai_read holds the coach's read as JSON (older data: plain text), or a pending marker. */
export function parseDuelRead(stored: string | null): DuelRead | null {
  if (!stored || stored.startsWith(READ_PENDING)) return null;
  if (!stored.startsWith('{')) return { read: stored, next_test: null };
  try {
    return JSON.parse(stored) as DuelRead;
  } catch {
    return null;
  }
}

/**
 * The winning cup of a revealed duel (null: a draw). A barista duel goes by its votes, since both
 * cups can be one recipe; a recipe duel by its winning recipe, which an imported duel keeps even
 * when the old app saved no vote counts.
 */
export function winnerSide(
  d: Pick<DuelDbRow, 'barista_x_id' | 'recipe_x_id' | 'recipe_y_id' | 'winner_recipe_id' | 'x_votes' | 'y_votes'>,
): 'x' | 'y' | null {
  if (d.barista_x_id) return d.x_votes > d.y_votes ? 'x' : d.y_votes > d.x_votes ? 'y' : null;
  return d.winner_recipe_id === d.recipe_x_id ? 'x' : d.winner_recipe_id === d.recipe_y_id ? 'y' : null;
}

/** Who may see which recipe (and in a barista duel, which barista) is X and which is Y. */
export function canSeeRecipes(duel: Pick<DuelDbRow, 'status' | 'created_by'>, viewerId: string): boolean {
  return duel.status === 'revealed' || duel.created_by === viewerId;
}

/** In a barista duel, the recipe the viewer brews (never which cup it goes in). */
function myRecipeId(d: DuelDbRow, viewerId: string): string | null {
  if (d.barista_x_id === viewerId) return d.recipe_x_id;
  if (d.barista_y_id === viewerId) return d.recipe_y_id;
  return null;
}

interface ScoreDbRow extends CupScores {
  duel_id: string;
  judge_member_id: string;
  cup: 'x' | 'y';
}

/**
 * Everything the views of these duels need, in a few queries: judges with their votes, the names
 * of only those recipes this viewer may see, and (with `scores`, for one duel's screen) the
 * judges' scores of revealed duels.
 */
export async function loadDuelViews(
  db: D1Database,
  viewer: AuthMember,
  duels: DuelDbRow[],
  opts: { scores?: boolean } = {},
): Promise<DuelView[]> {
  if (duels.length === 0) return [];
  const visibleRecipeIds = [
    ...duels.filter((d) => canSeeRecipes(d, viewer.id)).flatMap((d) => [d.recipe_x_id, d.recipe_y_id]),
    ...duels.map((d) => myRecipeId(d, viewer.id)).filter((id): id is string => id !== null),
  ];
  const revealedIds = opts.scores ? duels.filter((d) => d.status === 'revealed').map((d) => d.id) : [];
  const [judges, recipes, scores] = await Promise.all([
    db
      .prepare(
        `SELECT j.duel_id, j.member_id, m.name, v.choice
           FROM duel_judges j
           JOIN members m ON m.id = j.member_id
           LEFT JOIN duel_votes v ON v.duel_id = j.duel_id AND v.judge_member_id = j.member_id
          WHERE j.duel_id IN (SELECT value FROM json_each(?))
          ORDER BY m.name COLLATE NOCASE`,
      )
      .bind(JSON.stringify(duels.map((d) => d.id)))
      .all<JudgeDbRow>(),
    visibleRecipeIds.length === 0
      ? Promise.resolve({ results: [] as RecipeNameRow[] })
      : db
          .prepare(
            `SELECT r.id, r.code, r.name, m.name AS owner_name
               FROM recipes r JOIN members m ON m.id = r.owner_member_id
              WHERE r.team_id = ? AND r.id IN (SELECT value FROM json_each(?))`,
          )
          .bind(viewer.team_id, JSON.stringify([...new Set(visibleRecipeIds)]))
          .all<RecipeNameRow>(),
    revealedIds.length === 0
      ? Promise.resolve({ results: [] as ScoreDbRow[] })
      : db
          .prepare(
            `SELECT duel_id, judge_member_id, cup, ${JUDGING_CRITERIA.join(', ')}
               FROM duel_scores WHERE duel_id IN (SELECT value FROM json_each(?))`,
          )
          .bind(JSON.stringify(revealedIds))
          .all<ScoreDbRow>(),
  ]);
  const judgesByDuel = new Map<string, JudgeDbRow[]>();
  for (const j of judges.results) {
    const list = judgesByDuel.get(j.duel_id) ?? [];
    list.push(j);
    judgesByDuel.set(j.duel_id, list);
  }
  const recipeById = new Map(recipes.results.map((r) => [r.id, r]));
  const scoresByDuel = new Map<string, ScoreDbRow[]>();
  for (const row of scores.results) scoresByDuel.set(row.duel_id, [...(scoresByDuel.get(row.duel_id) ?? []), row]);
  return duels.map((d) => toDuelView(d, viewer, judgesByDuel.get(d.id) ?? [], recipeById, scoresByDuel.get(d.id) ?? []));
}

const cupScores = (row: CupScores): CupScores =>
  Object.fromEntries(JUDGING_CRITERIA.map((k) => [k, row[k]])) as CupScores;

/** The judges' average per criterion for each cup (one decimal), or null if nobody scored. */
function averageScores(rows: ScoreDbRow[]): { x: CupScores; y: CupScores } | null {
  const cup = (letter: 'x' | 'y'): CupScores | null => {
    const mine = rows.filter((r) => r.cup === letter);
    if (mine.length === 0) return null;
    return Object.fromEntries(
      JUDGING_CRITERIA.map((k) => [k, Math.round((mine.reduce((sum, r) => sum + r[k], 0) / mine.length) * 10) / 10]),
    ) as CupScores;
  };
  const x = cup('x');
  const y = cup('y');
  return x && y ? { x, y } : null;
}

const person = (id: string | null, name: string | null): DuelPerson | null =>
  id && name ? { id, name, initials: initialsOf(name) } : null;

function duelRecipe(id: string, recipes: Map<string, RecipeNameRow>): DuelRecipe | null {
  const r = recipes.get(id);
  return r ? { id: r.id, display_code: displayCode(r.owner_name, r.code), name: r.name } : null;
}

/** The one place a duel is turned into what a member may see. Built field by field, never spread. */
export function toDuelView(
  d: DuelDbRow,
  viewer: AuthMember,
  judgeRows: JudgeDbRow[],
  recipes: Map<string, RecipeNameRow>,
  scoreRows: ScoreDbRow[] = [],
): DuelView {
  const revealed = d.status === 'revealed';
  const showRecipes = canSeeRecipes(d, viewer.id);
  const judges: DuelJudge[] = judgeRows.map((j) => {
    const x = revealed ? scoreRows.find((r) => r.judge_member_id === j.member_id && r.cup === 'x') : undefined;
    const y = revealed ? scoreRows.find((r) => r.judge_member_id === j.member_id && r.cup === 'y') : undefined;
    return {
      id: j.member_id,
      name: j.name,
      initials: initialsOf(j.name),
      voted: j.choice !== null,
      choice: revealed ? j.choice : null,
      scores: x && y ? { x: cupScores(x), y: cupScores(y) } : null,
    };
  });
  const mine = judgeRows.find((j) => j.member_id === viewer.id);
  const votesIn = judgeRows.filter((j) => j.choice !== null).length;
  const bx = person(d.barista_x_id, d.barista_x_name);
  const by = person(d.barista_y_id, d.barista_y_name);
  // Everyone may know who competes; the order is by name so it says nothing about the cups.
  const baristas = bx && by ? [bx, by].sort((p, q) => p.name.localeCompare(q.name) || p.id.localeCompare(q.id)) : null;
  const myRecipe = myRecipeId(d, viewer.id);
  return {
    id: d.id,
    kind: d.barista_x_id ? 'baristas' : 'recipes',
    status: d.status,
    bean: d.bean_id && d.bean_name ? { id: d.bean_id, name: d.bean_name } : null,
    created_by: d.created_by && d.creator_name ? { id: d.created_by, name: d.creator_name, initials: initialsOf(d.creator_name) } : null,
    created_at: d.created_at,
    revealed_at: d.revealed_at,
    judges,
    votes_in: votesIn,
    baristas,
    x: showRecipes ? duelRecipe(d.recipe_x_id, recipes) : null,
    y: showRecipes ? duelRecipe(d.recipe_y_id, recipes) : null,
    x_barista: showRecipes ? bx : null,
    y_barista: showRecipes ? by : null,
    result: revealed
      ? {
          x_votes: d.x_votes,
          y_votes: d.y_votes,
          ties: Math.max(0, votesIn - d.x_votes - d.y_votes),
          winner: winnerSide(d),
          scores: averageScores(scoreRows),
        }
      : null,
    // A rematch swaps the cups, so judges who saw the first reveal could tell them apart:
    // before this reveal, only the creator learns it is a rematch.
    rematch_of: showRecipes ? d.rematch_of : null,
    rematch_id: d.rematch_id,
    // Notes can name the recipes ("R3 vs R5, hotter"), so they follow the same rule.
    notes: showRecipes ? d.notes : null,
    ai_read: revealed ? parseDuelRead(d.ai_read) : null,
    you: {
      is_creator: d.created_by === viewer.id,
      is_judge: Boolean(mine),
      vote: mine?.choice ?? null,
      can_manage: d.created_by === viewer.id || viewer.role === 'owner',
      is_barista: myRecipe !== null,
      my_recipe: myRecipe ? duelRecipe(myRecipe, recipes) : null,
    },
  };
}

const COUNT = (choice: DuelChoice) => `(SELECT COUNT(*) FROM duel_votes v WHERE v.duel_id = duels.id AND v.choice = '${choice}')`;

/**
 * Reveal a duel that is being judged: count the votes, pick the winner (more X or Y votes; equal
 * is a draw) and stamp revealed_at. With `whenAllVoted` it only fires once every judge has voted,
 * so the last vote reveals it. The status check makes a second, racing reveal a no-op.
 */
export function revealStatement(db: D1Database, teamId: string, duelId: string, now: number, whenAllVoted: boolean) {
  return db
    .prepare(
      `UPDATE duels SET
         status = 'revealed',
         x_votes = ${COUNT('x')},
         y_votes = ${COUNT('y')},
         winner_recipe_id = CASE
           WHEN ${COUNT('x')} > ${COUNT('y')} THEN recipe_x_id
           WHEN ${COUNT('y')} > ${COUNT('x')} THEN recipe_y_id
           ELSE NULL END,
         revealed_at = ?
       WHERE id = ? AND team_id = ? AND status = 'judging'
         AND (SELECT COUNT(*) FROM duel_votes v WHERE v.duel_id = duels.id) >= ${whenAllVoted ? 'judge_count' : '1'}`,
    )
    .bind(now, duelId, teamId);
}

/** X or Y for recipe A, by a fair coin from the Workers crypto RNG. */
export function coinFlip(): boolean {
  const [byte = 0] = crypto.getRandomValues(new Uint8Array(1));
  return (byte & 1) === 1;
}
