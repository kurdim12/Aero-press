// The coach's tips on one bean or recipe, kept in ai_tips: the latest set for each, shared by the
// team. While a bean or recipe is new, the first phone that opens it asks for them on its own (if
// the owner leaves automatic tips on); anyone can ask again later with "Update tips".
import type { BeanTips, RecipeTips, TipsResponse, TipsSubject } from '../../../shared/types';
import { beanTipsOutput, recipeTipsOutput } from '../../../shared/schemas';
import { notFound } from '../lib/errors';
import { type AiScope, askJson, requireAi } from './client';
import { beanFocus, recipeFocus, teamSnapshot } from './context';
import { toExperiment } from './experiments';
import { COACH_SYSTEM, beanTipsPrompt, recipeTipsPrompt, teamBlock } from './prompts';

export interface TipsOf {
  bean: BeanTips;
  recipe: RecipeTips;
}

/** Tips being written are claimed as `pending:<ms>` first, so a second phone waits for them. */
const PENDING = 'pending:';
/** Longer than the slowest write (a call and its one retry); an older claim was abandoned. */
const CLAIM_MS = 6 * 60_000;
/** Beans and recipes younger than this get their tips without a tap. */
export const TIPS_AUTO_MS = 24 * 60 * 60_000;

const TABLE: Record<TipsSubject, string> = { bean: 'beans', recipe: 'recipes' };

interface TipsRow {
  tips_json: string | null;
  tips_at: number | null;
  claim: string | null;
}

interface SubjectRow {
  created_at: number;
  updated_at: number;
  auto_tips: number;
}

const rowKey = (subject: TipsSubject, id: string) => `${subject}:${id}`;

async function load(db: D1Database, teamId: string, subject: TipsSubject, id: string): Promise<{ about: SubjectRow; row: TipsRow | null }> {
  const [about, row] = await Promise.all([
    db
      .prepare(
        `SELECT s.created_at, s.updated_at, t.ai_auto_tips AS auto_tips
           FROM ${TABLE[subject]} s JOIN teams t ON t.id = s.team_id
          WHERE s.id = ? AND s.team_id = ?`,
      )
      .bind(id, teamId)
      .first<SubjectRow>(),
    db.prepare('SELECT tips_json, tips_at, claim FROM ai_tips WHERE id = ? AND team_id = ?').bind(rowKey(subject, id), teamId).first<TipsRow>(),
  ]);
  if (!about) throw notFound(subject);
  return { about, row };
}

const claimFresh = (claim: string | null, now: number) => claim !== null && now - Number(claim.slice(PENDING.length)) < CLAIM_MS;

function view<S extends TipsSubject>(scope: AiScope, about: SubjectRow, row: TipsRow | null, now = Date.now()): TipsResponse<TipsOf[S]> {
  const tips = row?.tips_json ? (JSON.parse(row.tips_json) as TipsOf[S]) : null;
  const at = row?.tips_at ?? null;
  const pending = claimFresh(row?.claim ?? null, now);
  const configured = scope.ai !== null;
  return {
    tips,
    at,
    pending,
    stale: tips !== null && at !== null && about.updated_at > at,
    configured,
    auto: configured && about.auto_tips === 1 && tips === null && !pending && now - about.created_at < TIPS_AUTO_MS,
  };
}

export async function getTips<S extends TipsSubject>(scope: AiScope, subject: S, id: string): Promise<TipsResponse<TipsOf[S]>> {
  const { about, row } = await load(scope.db, scope.member.team_id, subject, id);
  return view<S>(scope, about, row);
}

/**
 * Write new tips, unless another phone is writing them right now. Without `refresh`, tips already
 * written are returned as they are. The claim is a conditional write on the row exactly as it was
 * read, so two phones asking at the same moment never both pay for tips.
 */
export async function writeTips<S extends TipsSubject>(
  scope: AiScope,
  subject: S,
  id: string,
  refresh: boolean,
  keepAlive: (work: Promise<unknown>) => void,
): Promise<TipsResponse<TipsOf[S]>> {
  const db = scope.db;
  const team = scope.member.team_id;
  const key = rowKey(subject, id);
  const { about, row } = await load(db, team, subject, id);
  const now = Date.now();
  const current = view<S>(scope, about, row, now);
  if (current.pending || (current.tips && !refresh)) return current;
  requireAi(scope);

  const marker = `${PENDING}${now}`;
  const claim = row
    ? await db
        .prepare('UPDATE ai_tips SET claim = ? WHERE id = ? AND team_id = ? AND claim IS ? AND tips_at IS ?')
        .bind(marker, key, team, row.claim, row.tips_at)
        .run()
    : await db
        .prepare('INSERT OR IGNORE INTO ai_tips (id, team_id, subject, subject_id, claim, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(key, team, subject, id, marker, now)
        .run();
  if (claim.meta.changes === 0) {
    // Another phone got there first: show what it did (its tips, or that it's writing them).
    const again = await load(db, team, subject, id);
    return view<S>(scope, again.about, again.row);
  }

  const work = (async () => {
    try {
      const tips = await WRITERS[subject](scope, id);
      const at = Date.now();
      // Saved only while the claim holds; if another phone took over a stale claim, its tips stand.
      await db
        .prepare('UPDATE ai_tips SET tips_json = ?, tips_at = ?, member_id = ?, claim = NULL WHERE id = ? AND team_id = ? AND claim = ?')
        .bind(JSON.stringify(tips), at, scope.member.id, key, team, marker)
        .run();
      return { tips, at };
    } catch (err) {
      // Free the claim so the next tap can try again.
      await db
        .prepare('UPDATE ai_tips SET claim = NULL WHERE id = ? AND team_id = ? AND claim = ?')
        .bind(key, team, marker)
        .run()
        .catch(() => undefined);
      throw err;
    }
  })();
  // If the phone closes mid-answer, the Worker still finishes and saves what it paid for.
  keepAlive(work.catch(() => undefined));
  const { tips, at } = await work;
  return { tips, at, pending: false, stale: false, configured: true, auto: false };
}

type Writers = { [S in TipsSubject]: (scope: AiScope, id: string) => Promise<TipsOf[S]> };

const WRITERS: Writers = {
  bean: async (scope, beanId) => {
    const snap = await teamSnapshot(scope.db, scope.member.team_id);
    const coffee = await beanFocus(scope.db, scope.member.team_id, beanId, snap.recipes);
    const out = await askJson(scope, 'beanTips', beanTipsOutput, COACH_SYSTEM, `${teamBlock(snap.team)}\n\n${beanTipsPrompt(coffee)}`);
    return {
      summary: out.summary,
      tips: out.tips,
      start: out.start ? toExperiment(out.start, snap.recipes, snap.beans, { beanId }) : null,
    };
  },
  recipe: async (scope, recipeId) => {
    const snap = await teamSnapshot(scope.db, scope.member.team_id);
    const recipe = snap.recipes.find((r) => r.id === recipeId);
    if (!recipe) throw notFound('recipe');
    const focus = await recipeFocus(scope.db, scope.member.team_id, recipe, snap.recipes);
    const out = await askJson(
      scope,
      'recipeTips',
      recipeTipsOutput,
      COACH_SYSTEM,
      `${teamBlock(snap.team)}\n\n${recipeTipsPrompt(recipe.display_code, focus)}`,
    );
    return {
      verdict: out.verdict,
      tips: out.tips,
      checks: out.checks,
      next_test: out.next_test ? toExperiment(out.next_test, snap.recipes, snap.beans, { parent: recipe }) : null,
    };
  },
};
