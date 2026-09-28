import { Hono } from 'hono';
import type { AppEnv, AuthMember } from '../env';
import { replayElo } from '../../../shared/elo';
import { initialsOf } from '../../../shared/initials';
import { type BaristaStanding, type BaristaStandingsResponse, type DuelReadResponse, type DuelView, type DuelsResponse, JUDGING_CRITERIA } from '../../../shared/types';
import { duelInput, duelVoteInput } from '../../../shared/schemas';
import { requireMember } from '../middleware/auth';
import { aiSetup } from '../ai/client';
import { writeDuelRead } from '../ai/reads';
import {
  READ_PENDING,
  coinFlip,
  getDuelRow,
  isFinished,
  listDuelRows,
  loadDuelViews,
  parseDuelRead,
  revealStatement,
  type DuelDbRow,
} from '../lib/duels';
import { ApiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { assertTeamBean } from '../lib/recipes';
import { idParam, readJson } from '../lib/validate';

// Blind duels. Phones poll GET /:id every 2 seconds while a duel is open.
export const duelRoutes = new Hono<AppEnv>();
duelRoutes.use('*', requireMember);

async function viewOf(db: D1Database, me: AuthMember, id: string): Promise<DuelView> {
  const [view] = await loadDuelViews(db, me, [await getDuelRow(db, me.team_id, id)], { scores: true });
  if (!view) throw new ApiError(500, 'server_error', 'Something went wrong on our side. Try again in a moment.');
  return view;
}

function assertCanManage(duel: DuelDbRow, me: AuthMember): void {
  if (duel.created_by !== me.id && me.role !== 'owner') {
    throw new ApiError(403, 'not_duel_helper', 'Only the person who started this duel, or the owner, can do that.');
  }
}

const duelOver = () => new ApiError(409, 'duel_over', 'This duel is already over. Start a new one or a rematch.');

/**
 * The judges must be active teammates: not the person pouring or hosting (they know which cup is
 * which), and not a barista in the duel (they made one of the cups).
 */
async function checkJudges(db: D1Database, me: AuthMember, judgeIds: string[], baristas: string[] = []): Promise<string[]> {
  const unique = [...new Set(judgeIds)];
  if (unique.includes(me.id)) {
    throw new ApiError(400, 'helper_cannot_judge', 'You’re pouring, so you know which cup is which. Pick other judges.', {
      field: 'judge_ids',
    });
  }
  if (unique.some((judge) => baristas.includes(judge))) {
    throw new ApiError(400, 'barista_cannot_judge', 'A barista in this duel can’t judge it. Pick other judges.', { field: 'judge_ids' });
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

/** Both baristas must be active teammates. */
async function checkBaristas(db: D1Database, me: AuthMember, a: string, b: string): Promise<void> {
  const { results } = await db
    .prepare('SELECT id FROM members WHERE team_id = ? AND active = 1 AND id IN (?, ?)')
    .bind(me.team_id, a, b)
    .all<{ id: string }>();
  if (results.length !== 2) {
    throw new ApiError(400, 'barista_not_found', 'One of the baristas is no longer on the team. Pick them again.', { field: 'barista_a_id' });
  }
}

/** Insert a duel (already pouring) with its judges; X and Y (recipes, and baristas) come from the caller. */
async function insertDuel(
  db: D1Database,
  me: AuthMember,
  duel: {
    x: string;
    y: string;
    /** Barista duels: who brews cup X and cup Y. */
    baristas: { x: string; y: string } | null;
    bean_id: string | null;
    judges: string[];
    notes: string | null;
    rematch_of: string | null;
  },
): Promise<string> {
  const id = newId();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO duels (id, team_id, recipe_x_id, recipe_y_id, barista_x_id, barista_y_id, bean_id, judge_count, status, notes,
                            rematch_of, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pouring', ?, ?, ?, ?)`,
      )
      .bind(
        id,
        me.team_id,
        duel.x,
        duel.y,
        duel.baristas?.x ?? null,
        duel.baristas?.y ?? null,
        duel.bean_id,
        duel.judges.length,
        duel.notes,
        duel.rematch_of,
        me.id,
        now,
      ),
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

/**
 * Start a duel: the server decides which side is X and which is Y. In a barista duel each barista
 * brews their own recipe (both may brew the same one), and the one who starts it hosts.
 */
duelRoutes.post('/', async (c) => {
  const input = await readJson(c, duelInput);
  const me = c.get('member');
  const db = c.env.DB;
  const recipeIds = [...new Set([input.recipe_a_id, input.recipe_b_id])];
  const { results } = await db
    .prepare('SELECT id FROM recipes WHERE team_id = ? AND id IN (SELECT value FROM json_each(?))')
    .bind(me.team_id, JSON.stringify(recipeIds))
    .all<{ id: string }>();
  if (results.length !== recipeIds.length) {
    throw new ApiError(400, 'recipe_not_found', 'One of the recipes no longer exists. Pick the recipes again.', {
      field: 'recipe_a_id',
    });
  }
  await assertTeamBean(db, me.team_id, input.bean_id);
  const baristas = input.kind === 'baristas' ? [input.barista_a_id, input.barista_b_id] : [];
  if (input.kind === 'baristas') await checkBaristas(db, me, input.barista_a_id, input.barista_b_id);
  const judges = await checkJudges(db, me, input.judge_ids, baristas);
  const aIsX = coinFlip();
  const id = await insertDuel(db, me, {
    x: aIsX ? input.recipe_a_id : input.recipe_b_id,
    y: aIsX ? input.recipe_b_id : input.recipe_a_id,
    baristas: input.kind === 'baristas' ? (aIsX ? { x: input.barista_a_id, y: input.barista_b_id } : { x: input.barista_b_id, y: input.barista_a_id }) : null,
    bean_id: input.bean_id ?? null,
    judges,
    notes: input.notes ?? null,
    rematch_of: null,
  });
  return c.json<DuelView>(await viewOf(db, me, id), 201);
});

/**
 * The baristas' ranking: Elo and record from revealed barista duels, and the average overall
 * score judges gave their cups. Read when the Duel tab opens (not polled).
 */
duelRoutes.get('/standings', async (c) => {
  const me = c.get('member');
  const db = c.env.DB;
  const [duels, members, overall] = await Promise.all([
    db
      .prepare(
        `SELECT id, barista_x_id, barista_y_id, x_votes, y_votes, revealed_at FROM duels
          WHERE team_id = ? AND status = 'revealed' AND barista_x_id IS NOT NULL AND revealed_at IS NOT NULL`,
      )
      .bind(me.team_id)
      .all<{ id: string; barista_x_id: string; barista_y_id: string; x_votes: number; y_votes: number; revealed_at: number }>(),
    db.prepare('SELECT id, name FROM members WHERE team_id = ?').bind(me.team_id).all<{ id: string; name: string }>(),
    db
      .prepare(
        `SELECT CASE s.cup WHEN 'x' THEN d.barista_x_id ELSE d.barista_y_id END AS member_id, AVG(s.overall) AS avg_overall
           FROM duel_scores s JOIN duels d ON d.id = s.duel_id
          WHERE d.team_id = ? AND d.status = 'revealed' AND d.barista_x_id IS NOT NULL
          GROUP BY member_id`,
      )
      .bind(me.team_id)
      .all<{ member_id: string; avg_overall: number | null }>(),
  ]);
  const table = replayElo(
    duels.results.map((d) => ({
      id: d.id,
      recipe_x_id: d.barista_x_id,
      recipe_y_id: d.barista_y_id,
      winner_recipe_id: d.x_votes > d.y_votes ? d.barista_x_id : d.y_votes > d.x_votes ? d.barista_y_id : null,
      revealed_at: d.revealed_at,
      bean_id: null,
    })),
  );
  const names = new Map(members.results.map((m) => [m.id, m.name]));
  const averages = new Map(overall.results.map((o) => [o.member_id, o.avg_overall]));
  const baristas: BaristaStanding[] = [...table.entries()]
    .map(([id, s]) => {
      const name = names.get(id) ?? '';
      const avg = averages.get(id);
      return {
        id,
        name,
        initials: initialsOf(name),
        elo: Math.round(s.elo),
        wins: s.wins,
        losses: s.losses,
        draws: s.draws,
        duels: s.duels,
        avg_overall: avg == null ? null : Math.round(avg * 10) / 10,
      };
    })
    .sort((a, b) => b.elo - a.elo || b.duels - a.duels || a.name.localeCompare(b.name));
  return c.json<BaristaStandingsResponse>({ baristas });
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

/**
 * One vote per judge, with their scores for both cups on every criterion. The last vote reveals
 * the duel in the same transaction.
 */
duelRoutes.post('/:id/vote', async (c) => {
  const id = idParam(c, 'duel');
  const { choice, scores } = await readJson(c, duelVoteInput);
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
  const score = (cup: 'x' | 'y') =>
    db
      .prepare(
        `INSERT OR IGNORE INTO duel_scores (duel_id, judge_member_id, cup, ${JUDGING_CRITERIA.join(', ')})
         VALUES (?, ?, ?, ${JUDGING_CRITERIA.map(() => '?').join(', ')})`,
      )
      .bind(id, me.id, cup, ...JUDGING_CRITERIA.map((k) => scores[cup][k]));
  await db.batch([
    db
      .prepare('INSERT OR IGNORE INTO duel_votes (duel_id, judge_member_id, choice, created_at) VALUES (?, ?, ?, ?)')
      .bind(id, me.id, choice, now),
    score('x'),
    score('y'),
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
 * Rematch a revealed duel with X and Y swapped, so cup position can't bias the result. Same bean,
 * judges and (in a barista duel) baristas; whoever starts it pours or hosts, so they drop out of
 * the judges. Tapping twice returns the same rematch.
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
    baristas: duel.barista_x_id && duel.barista_y_id ? { x: duel.barista_y_id, y: duel.barista_x_id } : null,
    bean_id: duel.bean_id,
    judges,
    notes: null,
    rematch_of: duel.id,
  });
  return c.json<DuelView>(await viewOf(db, me, rematchId), 201);
});

/**
 * How long a phone's claim on writing the duel read holds. Longer than the slowest possible
 * write (two calls, each allowed a 90 s wait for the first byte plus one retry), so a slow but
 * live write is never duplicated; a claim left by a Worker that died is taken over after this.
 */
const READ_CLAIM_MS = 6 * 60_000;

/**
 * The coach's read of a revealed duel, written once. The first phone to ask claims it and writes
 * it; the others get "pending" (202) and ask again a few seconds later.
 */
duelRoutes.post('/:id/read', async (c) => {
  const id = idParam(c, 'duel');
  const me = c.get('member');
  const db = c.env.DB;
  const duel = await getDuelRow(db, me.team_id, id);
  if (duel.status !== 'revealed') throw new ApiError(409, 'not_revealed', 'The coach reads a duel once it’s revealed.');
  const existing = parseDuelRead(duel.ai_read);
  if (existing) return c.json<DuelReadResponse>({ read: existing, pending: false });

  const marker = `${READ_PENDING}${Date.now()}`;
  const claim = await db
    .prepare(
      `UPDATE duels SET ai_read = ? WHERE id = ? AND team_id = ?
         AND (ai_read IS NULL OR (ai_read LIKE 'pending:%' AND CAST(substr(ai_read, 9) AS INTEGER) < ?))`,
    )
    .bind(marker, id, me.team_id, Date.now() - READ_CLAIM_MS)
    .run();
  if (claim.meta.changes === 0) return c.json<DuelReadResponse>({ read: null, pending: true }, 202);
  try {
    const read = await writeDuelRead({ db, ai: aiSetup(c.env), member: me }, duel, marker);
    return c.json<DuelReadResponse>({ read, pending: false });
  } catch (err) {
    await db.prepare('UPDATE duels SET ai_read = NULL WHERE id = ? AND team_id = ? AND ai_read = ?').bind(id, me.team_id, marker).run();
    throw err;
  }
});
