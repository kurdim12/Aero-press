import { Hono } from 'hono';
import type { AppEnv, AuthMember } from '../env';
import type { DuelView, DuelsResponse } from '../../../shared/types';
import { duelInput, duelVoteInput } from '../../../shared/schemas';
import { requireMember } from '../middleware/auth';
import { coinFlip, getDuelRow, isFinished, listDuelRows, loadDuelViews, revealStatement, type DuelDbRow } from '../lib/duels';
import { ApiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { assertTeamBean } from '../lib/recipes';
import { idParam, readJson } from '../lib/validate';

// Blind duels. Phones poll GET /:id every 2 seconds while a duel is open.
export const duelRoutes = new Hono<AppEnv>();
duelRoutes.use('*', requireMember);

async function viewOf(db: D1Database, me: AuthMember, id: string): Promise<DuelView> {
  const [view] = await loadDuelViews(db, me, [await getDuelRow(db, me.team_id, id)]);
  if (!view) throw new ApiError(500, 'server_error', 'Something went wrong on our side. Try again in a moment.');
  return view;
}

function assertCanManage(duel: DuelDbRow, me: AuthMember): void {
  if (duel.created_by !== me.id && me.role !== 'owner') {
    throw new ApiError(403, 'not_duel_helper', 'Only the person who started this duel, or the owner, can do that.');
  }
}

const duelOver = () => new ApiError(409, 'duel_over', 'This duel is already over. Start a new one or a rematch.');

/** The judges must be active teammates, and not the person pouring (they know which cup is which). */
async function checkJudges(db: D1Database, me: AuthMember, judgeIds: string[]): Promise<string[]> {
  const unique = [...new Set(judgeIds)];
  if (unique.includes(me.id)) {
    throw new ApiError(400, 'helper_cannot_judge', 'You’re pouring, so you know which cup is which. Pick other judges.', {
      field: 'judge_ids',
    });
  }
  const { results } = await db
    .prepare(`SELECT id FROM members WHERE team_id = ? AND active = 1 AND id IN (SELECT value FROM json_each(?))`)
    .bind(me.team_id, JSON.stringify(unique))
    .all<{ id: string }>();
  if (results.length !== unique.length) {
    throw new ApiError(400, 'judge_not_found', 'One of the judges is no longer on the team. Pick the judges again.', {
      field: 'judge_ids',
    });
  }
  return unique;
}

/** Insert a duel (already pouring) with its judges; X and Y come from the caller. */
async function insertDuel(
  db: D1Database,
  me: AuthMember,
  duel: { x: string; y: string; bean_id: string | null; judges: string[]; notes: string | null; rematch_of: string | null },
): Promise<string> {
  const id = newId();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO duels (id, team_id, recipe_x_id, recipe_y_id, bean_id, judge_count, status, notes, rematch_of, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pouring', ?, ?, ?, ?)`,
      )
      .bind(id, me.team_id, duel.x, duel.y, duel.bean_id, duel.judges.length, duel.notes, duel.rematch_of, me.id, now),
    ...duel.judges.map((judge) => db.prepare('INSERT INTO duel_judges (duel_id, member_id) VALUES (?, ?)').bind(id, judge)),
  ]);
  return id;
}

duelRoutes.get('/', async (c) => {
  const me = c.get('member');
  const rows = await listDuelRows(c.env.DB, me.team_id);
  const views = await loadDuelViews(c.env.DB, me, rows);
  return c.json<DuelsResponse>({
    active: views.filter((v) => !isFinished(v.status)),
    recent: views.filter((v) => isFinished(v.status)),
  });
});

/** Start a duel: the server decides which recipe is X and which is Y. */
duelRoutes.post('/', async (c) => {
  const input = await readJson(c, duelInput);
  const me = c.get('member');
  const db = c.env.DB;
  const { results } = await db
    .prepare('SELECT id FROM recipes WHERE team_id = ? AND id IN (?, ?)')
    .bind(me.team_id, input.recipe_a_id, input.recipe_b_id)
    .all<{ id: string }>();
  if (results.length !== 2) {
    throw new ApiError(400, 'recipe_not_found', 'One of the recipes no longer exists. Pick the recipes again.', {
      field: 'recipe_a_id',
    });
  }
  await assertTeamBean(db, me.team_id, input.bean_id);
  const judges = await checkJudges(db, me, input.judge_ids);
  const aIsX = coinFlip();
  const id = await insertDuel(db, me, {
    x: aIsX ? input.recipe_a_id : input.recipe_b_id,
    y: aIsX ? input.recipe_b_id : input.recipe_a_id,
    bean_id: input.bean_id ?? null,
    judges,
    notes: input.notes ?? null,
    rematch_of: null,
  });
  return c.json<DuelView>(await viewOf(db, me, id), 201);
});

duelRoutes.get('/:id', async (c) => {
  const me = c.get('member');
  return c.json<DuelView>(await viewOf(c.env.DB, me, idParam(c, 'duel')));
});

/** The helper has poured both cups: judging starts. */
duelRoutes.post('/:id/ready', async (c) => {
  const id = idParam(c, 'duel');
  const me = c.get('member');
  const db = c.env.DB;
  const duel = await getDuelRow(db, me.team_id, id);
  assertCanManage(duel, me);
  if (isFinished(duel.status)) throw duelOver();
  await db.prepare(`UPDATE duels SET status = 'judging' WHERE id = ? AND team_id = ? AND status IN ('setup', 'pouring')`).bind(id, me.team_id).run();
  return c.json<DuelView>(await viewOf(db, me, id));
});

/** One vote per judge. The last vote reveals the duel in the same transaction. */
duelRoutes.post('/:id/vote', async (c) => {
  const id = idParam(c, 'duel');
  const { choice } = await readJson(c, duelVoteInput);
  const me = c.get('member');
  const db = c.env.DB;
  const duel = await getDuelRow(db, me.team_id, id);
  const judge = await db
    .prepare(
      `SELECT j.member_id, v.choice FROM duel_judges j
         LEFT JOIN duel_votes v ON v.duel_id = j.duel_id AND v.judge_member_id = j.member_id
        WHERE j.duel_id = ? AND j.member_id = ?`,
    )
    .bind(id, me.id)
    .first<{ member_id: string; choice: string | null }>();
  if (!judge) throw new ApiError(403, 'not_a_judge', 'Only the judges picked for this duel can vote.');
  if (judge.choice !== null) {
    if (judge.choice === choice) return c.json<DuelView>(await viewOf(db, me, id));
    throw new ApiError(409, 'already_voted', 'You’ve already voted in this duel. Votes can’t change.');
  }
  if (duel.status === 'setup' || duel.status === 'pouring') {
    throw new ApiError(409, 'cups_not_ready', 'The cups aren’t ready yet. Wait for the helper to call them.');
  }
  if (duel.status !== 'judging') throw duelOver();

  const now = Date.now();
  await db.batch([
    db
      .prepare('INSERT OR IGNORE INTO duel_votes (duel_id, judge_member_id, choice, created_at) VALUES (?, ?, ?, ?)')
      .bind(id, me.id, choice, now),
    revealStatement(db, me.team_id, id, now, true),
  ]);
  return c.json<DuelView>(await viewOf(db, me, id));
});

/** Reveal with the votes that are in (a judge's phone died, say). Needs at least one vote. */
duelRoutes.post('/:id/reveal', async (c) => {
  const id = idParam(c, 'duel');
  const me = c.get('member');
  const db = c.env.DB;
  const duel = await getDuelRow(db, me.team_id, id);
  assertCanManage(duel, me);
  if (duel.status === 'revealed') return c.json<DuelView>(await viewOf(db, me, id));
  if (duel.status !== 'judging') {
    throw new ApiError(409, 'not_judging', 'The judges haven’t started yet. Call the cups ready first.');
  }
  const result = await revealStatement(db, me.team_id, id, Date.now(), false).run();
  if (result.meta.changes === 0) {
    const now = await getDuelRow(db, me.team_id, id);
    if (now.status !== 'revealed') throw new ApiError(409, 'no_votes', 'No votes are in yet. Wait for at least one judge.');
  }
  return c.json<DuelView>(await viewOf(db, me, id));
});

duelRoutes.post('/:id/cancel', async (c) => {
  const id = idParam(c, 'duel');
  const me = c.get('member');
  const db = c.env.DB;
  const duel = await getDuelRow(db, me.team_id, id);
  assertCanManage(duel, me);
  if (duel.status === 'revealed') throw duelOver();
  await db
    .prepare(`UPDATE duels SET status = 'cancelled' WHERE id = ? AND team_id = ? AND status IN ('setup', 'pouring', 'judging')`)
    .bind(id, me.team_id)
    .run();
  return c.json<DuelView>(await viewOf(db, me, id));
});

/**
 * Rematch a revealed duel with X and Y swapped, so cup position can't bias the result. Same bean
 * and judges; whoever starts it pours, so they drop out of the judges. Tapping twice returns the
 * same rematch.
 */
duelRoutes.post('/:id/rematch', async (c) => {
  const id = idParam(c, 'duel');
  const me = c.get('member');
  const db = c.env.DB;
  const duel = await getDuelRow(db, me.team_id, id);
  assertCanManage(duel, me);
  if (duel.status !== 'revealed') throw new ApiError(409, 'not_revealed', 'Only a revealed duel can be rematched.');
  if (duel.rematch_id) return c.json<DuelView>(await viewOf(db, me, duel.rematch_id));

  const { results } = await db
    .prepare('SELECT j.member_id FROM duel_judges j JOIN members m ON m.id = j.member_id WHERE j.duel_id = ? AND m.active = 1')
    .bind(id)
    .all<{ member_id: string }>();
  const judges = results.map((r) => r.member_id).filter((judge) => judge !== me.id);
  if (judges.length === 0) {
    throw new ApiError(409, 'no_judges_left', 'Nobody is left to judge a rematch. Start a new duel and pick judges.');
  }
  const rematchId = await insertDuel(db, me, {
    x: duel.recipe_y_id,
    y: duel.recipe_x_id,
    bean_id: duel.bean_id,
    judges,
    notes: null,
    rematch_of: duel.id,
  });
  return c.json<DuelView>(await viewOf(db, me, rematchId), 201);
});
