import { Hono, type Context } from 'hono';
import type { AppEnv } from '../env';
import { parseRef, sameRef } from '../../../shared/compare';
import type {
  AiUsage,
  ChampionBreakdownResponse,
  CompareRef,
  CompareResponse,
  ExperimentsResponse,
  QuickLogResponse,
  ReadinessReport,
  TodayResponse,
  TodaySession,
} from '../../../shared/types';
import {
  adaptInput,
  askInput,
  compareInput,
  compareQuery,
  experimentsOutput,
  explainInput,
  planInput,
  quickLogInput,
  quickLogOutput,
  readinessOutput,
  todayOutput,
} from '../../../shared/schemas';
import { requireMember } from '../middleware/auth';
import { aiScope, aiSetup, aiUsage, askJson, askStream, monthSpend } from '../ai/client';
import { localDay } from '../ai/config';
import { beanFocus, buildContextPack, findRecipeByCode, recipeFocus } from '../ai/context';
import { askSections } from '../ai/knowledge';
import { championState, compareState, writeChampionBreakdown, writeCompare } from '../ai/explain';
import { toExperiment, type TeamBean } from '../ai/experiments';
import {
  ASK_INSTRUCTIONS,
  COACH_SYSTEM,
  QUICK_LOG_SYSTEM,
  READINESS_PROMPT,
  TODAY_PROMPT,
  aboutBlock,
  adaptPrompt,
  dataBlock,
  planPrompt,
  quickLogUser,
} from '../ai/prompts';
import { ApiError, notFound } from '../lib/errors';
import { newId } from '../lib/ids';
import { displayCode } from '../lib/recipes';
import { idParam, readJson, readQuery } from '../lib/validate';

// The AI coach. Every call checks the month's budget first and logs its tokens and cost.
export const coachRoutes = new Hono<AppEnv>();
coachRoutes.use('*', requireMember);

const scopeOf = aiScope;

async function teamBeans(db: D1Database, teamId: string): Promise<TeamBean[]> {
  const { results } = await db.prepare('SELECT id, name FROM beans WHERE team_id = ?').bind(teamId).all<TeamBean>();
  return results;
}

coachRoutes.get('/usage', async (c) => {
  const me = c.get('member');
  return c.json<AiUsage>(aiUsage(aiSetup(c.env), await monthSpend(c.env.DB, me.team_id)));
});

/** Plan the next session: three experiments to duel against their parents. */
coachRoutes.post('/plan', async (c) => {
  const input = await readJson(c, planInput);
  const scope = scopeOf(c);
  const [{ pack, recipes }, beans] = await Promise.all([buildContextPack(scope.db, scope.member), teamBeans(scope.db, scope.member.team_id)]);
  const focus = input.recipe_id ? recipes.find((r) => r.id === input.recipe_id) : undefined;
  if (input.recipe_id && !focus) throw notFound('recipe');
  const out = await askJson(
    scope,
    'plan',
    experimentsOutput,
    COACH_SYSTEM,
    `${dataBlock(pack)}\n\n${planPrompt({ recipeCode: focus?.display_code ?? null, note: input.focus ?? null })}`,
  );
  return c.json<ExperimentsResponse>({ read: out.read, experiments: out.experiments.map((e) => toExperiment(e, recipes, beans)) });
});

/** Adapt a recipe to a new coffee: three versions of it for that bean. */
coachRoutes.post('/adapt', async (c) => {
  const input = await readJson(c, adaptInput);
  const scope = scopeOf(c);
  const [{ pack, recipes }, beans] = await Promise.all([buildContextPack(scope.db, scope.member), teamBeans(scope.db, scope.member.team_id)]);
  const recipe = recipes.find((r) => r.id === input.recipe_id);
  if (!recipe) throw notFound('recipe');
  const bean = beans.find((b) => b.id === input.bean_id);
  if (!bean) throw notFound('bean');
  const out = await askJson(scope, 'adapt', experimentsOutput, COACH_SYSTEM, `${dataBlock(pack)}\n\n${adaptPrompt(bean.name, recipe.display_code)}`);
  return c.json<ExperimentsResponse>({
    read: out.read,
    experiments: out.experiments.map((e) => toExperiment(e, recipes, beans, { parent: recipe, beanId: bean.id })),
  });
});

/** A card being written is saved as `pending:<ms>` first, so a second phone or tab waits for it. */
const TODAY_PENDING = 'pending:';
/** Longer than the slowest write (a call and its one retry); a claim older than this was abandoned. */
const TODAY_CLAIM_MS = 6 * 60_000;

type TodayState = { session: TodaySession } | { pending: string } | null;

async function todayState(db: D1Database, memberId: string, day: string): Promise<TodayState> {
  const row = await db
    .prepare(`SELECT result_json FROM coach_cache WHERE member_id = ? AND kind = 'today' AND day = ?`)
    .bind(memberId, day)
    .first<{ result_json: string }>();
  if (!row) return null;
  if (row.result_json.startsWith(TODAY_PENDING)) return { pending: row.result_json };
  return { session: JSON.parse(row.result_json) as TodaySession };
}

const claimAge = (marker: string) => Date.now() - Number(marker.slice(TODAY_PENDING.length));

/** Today's session card, if it has been written today (or `pending` while it is being written). */
coachRoutes.get('/today', async (c) => {
  const state = await todayState(c.env.DB, c.get('member').id, localDay());
  if (state && 'session' in state) return c.json<TodayResponse>({ session: state.session });
  return c.json<TodayResponse>({ session: null, ...(state ? { pending: true } : {}) });
});

/** Write today's card: once per member per day, however many phones or tabs ask at once. */
coachRoutes.post('/today', async (c) => {
  const scope = scopeOf(c);
  const db = scope.db;
  const memberId = scope.member.id;
  const today = localDay();
  const state = await todayState(db, memberId, today);
  if (state && 'session' in state) return c.json<TodayResponse>({ session: state.session });
  if (state && claimAge(state.pending) < TODAY_CLAIM_MS) return c.json<TodayResponse>({ session: null, pending: true });
  // Nothing to duel yet: no call, and nothing saved, so the card writes itself once there is.
  const count = await db.prepare('SELECT COUNT(*) AS n FROM recipes WHERE team_id = ?').bind(scope.member.team_id).first<{ n: number }>();
  if ((count?.n ?? 0) < 2) return c.json<TodayResponse>({ session: null, needs_recipes: true });

  const marker = `${TODAY_PENDING}${Date.now()}`;
  const claim = state
    ? await db
        .prepare(`UPDATE coach_cache SET result_json = ?, created_at = ? WHERE member_id = ? AND kind = 'today' AND day = ? AND result_json = ?`)
        .bind(marker, Date.now(), memberId, today, state.pending)
        .run()
    : await db
        .prepare(`INSERT OR IGNORE INTO coach_cache (team_id, member_id, kind, day, result_json, created_at) VALUES (?, ?, 'today', ?, ?, ?)`)
        .bind(scope.member.team_id, memberId, today, marker, Date.now())
        .run();
  if (claim.meta.changes === 0) return c.json<TodayResponse>({ session: null, pending: true });

  try {
    const { pack, recipes } = await buildContextPack(db, scope.member, { recipeLimit: 12 });
    const out = await askJson(scope, 'today', todayOutput, COACH_SYSTEM, `${dataBlock(pack)}\n\n${TODAY_PROMPT}`);
    const session: TodaySession = {
      day: today,
      summary: out.summary,
      duels: out.duels.map((d) => {
        const a = findRecipeByCode(recipes, d.a);
        const b = findRecipeByCode(recipes, d.b);
        return { a: a?.display_code ?? d.a, b: b?.display_code ?? d.b, a_id: a?.id ?? null, b_id: b?.id ?? null, why: d.why };
      }),
      created_at: Date.now(),
    };
    await db
      .prepare(`UPDATE coach_cache SET result_json = ?, created_at = ? WHERE member_id = ? AND kind = 'today' AND day = ? AND result_json = ?`)
      .bind(JSON.stringify(session), session.created_at, memberId, today, marker)
      .run();
    return c.json<TodayResponse>({ session });
  } catch (err) {
    // Let the next attempt try again (the caller decides whether to).
    await db
      .prepare(`DELETE FROM coach_cache WHERE member_id = ? AND kind = 'today' AND day = ? AND result_json = ?`)
      .bind(memberId, today, marker)
      .run();
    throw err;
  }
});

interface ReportRow {
  id: string;
  member_name: string;
  report_json: string;
  created_at: number;
}

const toReport = (row: ReportRow): ReadinessReport => ({
  id: row.id,
  member_name: row.member_name,
  created_at: row.created_at,
  ...(JSON.parse(row.report_json) as Omit<ReadinessReport, 'id' | 'member_name' | 'created_at'>),
});

/** The team's latest readiness report. */
coachRoutes.get('/readiness', async (c) => {
  const me = c.get('member');
  const row = await c.env.DB.prepare(
    `SELECT r.id, m.name AS member_name, r.report_json, r.created_at
       FROM readiness_reports r JOIN members m ON m.id = r.member_id
      WHERE r.team_id = ? ORDER BY r.created_at DESC LIMIT 1`,
  )
    .bind(me.team_id)
    .first<ReportRow>();
  return c.json<{ report: ReadinessReport | null }>({ report: row ? toReport(row) : null });
});

coachRoutes.post('/readiness', async (c) => {
  const scope = scopeOf(c);
  const { pack } = await buildContextPack(scope.db, scope.member);
  const out = await askJson(scope, 'readiness', readinessOutput, COACH_SYSTEM, `${dataBlock(pack)}\n\n${READINESS_PROMPT}`);
  const id = newId();
  const now = Date.now();
  await scope.db
    .prepare('INSERT INTO readiness_reports (id, team_id, member_id, report_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, scope.member.team_id, scope.member.id, JSON.stringify(out), now)
    .run();
  return c.json<{ report: ReadinessReport }>({ report: { id, member_name: scope.member.name, created_at: now, ...out } });
});

/**
 * Ask anything: the answer streams back in the provider's event format (the app reads the text).
 * `about` (from "Ask the coach about this") adds that bean or recipe in full.
 */
coachRoutes.post('/ask', async (c) => {
  const { question, about } = await readJson(c, askInput);
  const scope = scopeOf(c);
  const team = scope.member.team_id;
  const { pack, recipes } = await buildContextPack(scope.db, scope.member);
  let focus: string | null = null;
  if (about?.kind === 'recipe') {
    const recipe = recipes.find((r) => r.id === about.id);
    if (!recipe) throw notFound('recipe');
    focus = aboutBlock('recipe', await recipeFocus(scope.db, team, recipe, recipes));
  } else if (about?.kind === 'bean') {
    focus = aboutBlock('bean', await beanFocus(scope.db, team, about.id, recipes));
  }
  const user = [dataBlock(pack), focus, ASK_INSTRUCTIONS, `<question>\n${question}\n</question>`].filter(Boolean).join('\n\n');
  // The reference sections the question needs: the basics, what it names, what it's about.
  const { body, done } = await askStream(scope, 'ask', COACH_SYSTEM, user, { sections: askSections(question, about?.kind) });
  c.executionCtx.waitUntil(done);
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
});

/** GET /compare?a=&b=: each side as "recipe:<id>" or "champion:<id>". */
function compareRefs(c: Context<AppEnv>): [CompareRef, CompareRef] {
  const query = readQuery(c, compareQuery);
  const a = parseRef(query.a);
  const b = parseRef(query.b);
  if (!a || !b || sameRef(a, b)) throw new ApiError(400, 'invalid_input', 'Pick two different recipes.', { field: 'b' });
  return [a, b];
}

/** The team's kept explanation of two recipes' differences (null until someone asks). */
coachRoutes.get('/compare', async (c) => {
  const [a, b] = compareRefs(c);
  return c.json<CompareResponse>(await compareState(scopeOf(c), a, b));
});

/** Explain two recipes' differences (ours or champions'); kept for the whole team. */
coachRoutes.post('/compare', async (c) => {
  const input = await readJson(c, compareInput);
  const ask = { refresh: input.refresh === true, seen: input.seen ?? null };
  const res = await writeCompare(scopeOf(c), input.a, input.b, ask, (work) => c.executionCtx.waitUntil(work));
  return c.json<CompareResponse>(res, res.pending ? 202 : 200);
});

/** The team's kept breakdown of a World champion recipe (null until someone asks). */
coachRoutes.get('/champions/:id', async (c) => c.json<ChampionBreakdownResponse>(await championState(scopeOf(c), idParam(c, 'champion recipe'))));

coachRoutes.post('/champions/:id', async (c) => {
  const { refresh, seen } = await readJson(c, explainInput);
  const ask = { refresh: refresh === true, seen: seen ?? null };
  const res = await writeChampionBreakdown(scopeOf(c), idParam(c, 'champion recipe'), ask, (work) => c.executionCtx.waitUntil(work));
  return c.json<ChampionBreakdownResponse>(res, res.pending ? 202 : 200);
});

/** Quick log: a typed or spoken note turned into brew-log fields for the barista to confirm. */
coachRoutes.post('/quick-log', async (c) => {
  const input = await readJson(c, quickLogInput);
  const scope = scopeOf(c);
  const db = scope.db;
  const [recipes, beans] = await Promise.all([
    db
      .prepare(
        `SELECT r.id, r.code, r.name, m.name AS owner_name, b.name AS bean
           FROM recipes r JOIN members m ON m.id = r.owner_member_id LEFT JOIN beans b ON b.id = r.bean_id
          WHERE r.team_id = ? ORDER BY r.updated_at DESC LIMIT 200`,
      )
      .bind(scope.member.team_id)
      .all<{ id: string; code: string; name: string | null; owner_name: string; bean: string | null }>(),
    db
      .prepare('SELECT id, name, origin, variety, process FROM beans WHERE team_id = ? ORDER BY updated_at DESC LIMIT 100')
      .bind(scope.member.team_id)
      .all<{ id: string; name: string; origin: string | null; variety: string | null; process: string | null }>(),
  ]);
  const lists = {
    opened_from_recipe: input.recipe_id ?? null,
    recipes: recipes.results.map((r) => ({ id: r.id, code: displayCode(r.owner_name, r.code), name: r.name, bean: r.bean })),
    beans: beans.results,
  };
  const out = await askJson(scope, 'quickLog', quickLogOutput, QUICK_LOG_SYSTEM, quickLogUser(input.text, lists));
  // Only ids from the team's own lists; anything else is "not sure".
  const recipeIds = new Set(recipes.results.map((r) => r.id));
  const beanIds = new Set(beans.results.map((b) => b.id));
  const recipeMatch = out.recipeMatch.id && recipeIds.has(out.recipeMatch.id) ? out.recipeMatch : { id: null, confidence: 0 };
  const beanMatch = out.beanMatch.id && beanIds.has(out.beanMatch.id) ? out.beanMatch : { id: null, confidence: 0 };
  const { recipeMatch: _r, beanMatch: _b, ...fields } = out;
  return c.json<QuickLogResponse>({
    ...fields,
    recipe_id: recipeMatch.id,
    bean_id: beanMatch.id,
    recipeMatch,
    beanMatch,
  });
});
