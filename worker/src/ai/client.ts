// Every AI call goes through here: the budget check first, then the provider (OpenRouter or
// Anthropic, called from the Worker only; keys never reach the browser), then tokens and cost
// logged in ai_calls.
import Anthropic from '@anthropic-ai/sdk';
import type { Context } from 'hono';
import type { z } from 'zod';
import { type ModelRole, OPENROUTER_DEFAULTS, OPENROUTER_MODEL_IDS } from '../../../shared/aiModels';
import type { AiUsage } from '../../../shared/types';
import { chatStreamUsage } from '../../../shared/aiStream';
import type { AppEnv, AuthMember } from '../env';
import { ApiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { type AiKind, EFFORT, KIND_ROLE, MAX_TOKENS, MODELS, costUsd, monthStart } from './config';
import { parseAiJson, usageFromEvents } from './json';
import { ProviderHttpError, ProviderStreamError, chatBody, openRouterStream, readChatStream } from './openrouter';
import { type AiSetup, aiSetup, aiTransport } from './transport';

export { aiSetup, aiTransport };

export interface AiScope {
  db: D1Database;
  /** Provider and key (null until the owner adds one in Cloudflare). */
  ai: AiSetup | null;
  member: AuthMember;
}

/** The scope of a request's AI calls: its database, the provider set up in Cloudflare, the member. */
export const aiScope = (c: Context<AppEnv>): AiScope => ({ db: c.env.DB, ai: aiSetup(c.env), member: c.get('member') });

/** The provider, or 503 `ai_not_configured` until the owner adds a key. */
export function requireAi(scope: AiScope): AiSetup {
  if (!scope.ai) {
    throw new ApiError(503, 'ai_not_configured', 'The AI coach isn’t set up yet. The owner needs to add an OpenRouter or Anthropic API key in Cloudflare (see the README).');
  }
  return scope.ai;
}

const anthropic = (key: string) => new Anthropic({ apiKey: key, fetch: aiTransport.fetch, maxRetries: 1, timeout: 90_000 });

/** This month's spend, the cap, and the models the owner picked. */
export interface TeamAi {
  spent: number;
  calls: number;
  cap: number;
  coach_model: string | null;
  quick_model: string | null;
}

export async function monthSpend(db: D1Database, teamId: string): Promise<TeamAi> {
  const [team, usage] = await Promise.all([
    db
      .prepare('SELECT ai_monthly_budget_usd AS cap, ai_coach_model, ai_quick_model FROM teams WHERE id = ?')
      .bind(teamId)
      .first<{ cap: number; ai_coach_model: string | null; ai_quick_model: string | null }>(),
    db
      .prepare('SELECT COALESCE(SUM(cost_usd), 0) AS spent, COUNT(*) AS calls FROM ai_calls WHERE team_id = ? AND created_at >= ?')
      .bind(teamId, monthStart())
      .first<{ spent: number; calls: number }>(),
  ]);
  return {
    spent: usage?.spent ?? 0,
    calls: usage?.calls ?? 0,
    cap: team?.cap ?? 0,
    coach_model: team?.ai_coach_model ?? null,
    quick_model: team?.ai_quick_model ?? null,
  };
}

/** The OpenRouter model for a role: the owner's pick if it's still on the list, else the default. */
export function openRouterModel(team: Pick<TeamAi, 'coach_model' | 'quick_model'>, role: ModelRole): string {
  const picked = role === 'coach' ? team.coach_model : team.quick_model;
  return picked && (OPENROUTER_MODEL_IDS as readonly string[]).includes(picked) ? picked : OPENROUTER_DEFAULTS[role];
}

/** The model a call uses: the spec's Claude pair on an Anthropic key, the owner's picks on OpenRouter. */
export function modelFor(setup: AiSetup, kind: AiKind, team: Pick<TeamAi, 'coach_model' | 'quick_model'>): string {
  return setup.provider === 'openrouter' ? openRouterModel(team, KIND_ROLE[kind]) : MODELS[kind];
}

/** What the Coach tab and the Board show about the AI: set up or not, which models, spend and cap. */
export function aiUsage(setup: AiSetup | null, team: TeamAi): AiUsage {
  return {
    configured: setup !== null,
    provider: setup?.provider ?? null,
    models: setup ? { coach: modelFor(setup, 'plan', team), quick: modelFor(setup, 'quickLog', team) } : null,
    month_spend_usd: Math.round(team.spent * 10_000) / 10_000,
    cap_usd: team.cap,
    calls: team.calls,
  };
}

/** Before every call: stop once the month's spend reaches the owner's cap. */
async function checkBudget(scope: AiScope): Promise<TeamAi> {
  const team = await monthSpend(scope.db, scope.member.team_id);
  if (team.spent >= team.cap) {
    throw new ApiError(402, 'ai_budget_exceeded', 'AI budget for this month is used up. The owner can raise it in Settings.');
  }
  return team;
}

/** About 3 characters a token, rounded up: a reservation should err high. */
const estimateTokens = (text: string) => Math.ceil(text.length / 3);

/**
 * Before each call, a row priced at its worst case (the estimated input plus the full output
 * allowance) goes into ai_calls. Calls running at the same time then see each other's cost, and
 * a call that never reports back (a timeout, a phone that hangs up mid-answer) still counts. The
 * row is corrected once the real usage is known. Prices come from the model we asked for, so a
 * differently named model in the reply can never make a call look free.
 */
async function reserve(scope: AiScope, kind: AiKind, model: string, system: string, user: string): Promise<string> {
  const input = estimateTokens(system) + estimateTokens(user);
  const output = MAX_TOKENS[kind];
  const id = newId();
  await scope.db
    .prepare(
      `INSERT INTO ai_calls (id, team_id, member_id, kind, model, input_tokens, output_tokens, cost_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, scope.member.team_id, scope.member.id, kind, model, input, output, costUsd(model, input, output), Date.now())
    .run();
  return id;
}

/** The real usage of a call. `cost` is what the provider charged, when it says (OpenRouter does). */
interface Spent {
  input: number;
  output: number;
  cost: number | null;
}

async function settle(scope: AiScope, id: string, model: string, spent: Spent): Promise<void> {
  const cost = spent.cost ?? costUsd(model, spent.input, spent.output);
  await scope.db
    .prepare('UPDATE ai_calls SET input_tokens = ?, output_tokens = ?, cost_usd = ? WHERE id = ? AND team_id = ?')
    .bind(spent.input, spent.output, cost, id, scope.member.team_id)
    .run();
}

/** The provider turned the request away with an HTTP error, so nothing was billed. */
const refusedByApi = (err: unknown) =>
  err instanceof ProviderHttpError || (err instanceof Anthropic.APIError && typeof err.status === 'number');

async function release(scope: AiScope, id: string): Promise<void> {
  await scope.db.prepare('DELETE FROM ai_calls WHERE id = ? AND team_id = ?').bind(id, scope.member.team_id).run();
}

const keyInvalid = () => new ApiError(503, 'ai_key_invalid', 'The AI key was refused. The owner needs to check it in Cloudflare.');
const busy = () => new ApiError(503, 'ai_busy', 'The AI coach is busy right now. Try again in a minute.');
const billing = () =>
  new ApiError(503, 'ai_billing', 'The AI account can’t take requests right now (credits or billing). The owner needs to check it.');
const refused = () => new ApiError(422, 'ai_refused', 'The coach couldn’t answer that one. Try asking another way.');

/** Provider errors, in words the team can act on. Retryable ones say "try again". */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof ProviderHttpError) {
    if (err.status === 401) return keyInvalid();
    if (err.status === 402) return billing();
    if (err.status === 403) return refused(); // OpenRouter's moderation flagged the request
    if (err.status === 408 || err.status === 429 || err.status >= 500) return busy();
    console.error('AI call failed', err.status, err.message);
    return new ApiError(502, 'ai_failed', 'The AI coach couldn’t answer. Try again; if it keeps happening, tell the owner.');
  }
  if (err instanceof ProviderStreamError || (err instanceof Error && err.name === 'AbortError')) return busy();
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return keyInvalid();
  if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
    return busy();
  }
  if (err instanceof Anthropic.APIError && err.status === 402) return billing();
  console.error('AI call failed', err instanceof Error ? err.message : String(err));
  return new ApiError(502, 'ai_failed', 'The AI coach couldn’t answer. Try again; if it keeps happening, tell the owner.');
}

function anthropicParams(model: string, kind: AiKind, system: string, user: string) {
  const effort = EFFORT[kind];
  return {
    model,
    max_tokens: MAX_TOKENS[kind],
    system,
    messages: [{ role: 'user' as const, content: user }],
    ...(effort ? { output_config: { effort } } : {}),
  };
}

/**
 * One call, text back. It streams under the hood on either provider: a timeout only covers the
 * wait for the first bytes, so a long answer is never cut off (and then paid for again).
 */
export async function askText(scope: AiScope, kind: AiKind, system: string, user: string): Promise<string> {
  const setup = requireAi(scope);
  const model = modelFor(setup, kind, await checkBudget(scope));
  const reservation = await reserve(scope, kind, model, system, user);

  if (setup.provider === 'openrouter') {
    let result: Awaited<ReturnType<typeof readChatStream>>;
    try {
      const res = await openRouterStream(setup.key, chatBody(model, kind, system, user));
      result = await readChatStream(res.body!);
    } catch (err) {
      if (refusedByApi(err)) await release(scope, reservation);
      throw toApiError(err);
    }
    // No usage in the reply: the worst-case reservation stands.
    if (result.usage) {
      await settle(scope, reservation, model, { input: result.usage.prompt_tokens, output: result.usage.completion_tokens, cost: result.usage.cost });
    }
    if (result.finish === 'content_filter') throw refused();
    return result.text;
  }

  let message: Anthropic.Message;
  try {
    message = await anthropic(setup.key).messages.stream(anthropicParams(model, kind, system, user)).finalMessage();
  } catch (err) {
    if (refusedByApi(err)) await release(scope, reservation);
    throw toApiError(err);
  }
  const u = message.usage;
  await settle(scope, reservation, model, {
    input: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    output: u.output_tokens,
    cost: null,
  });
  if (message.stop_reason === 'refusal') throw refused();
  return message.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim();
}

/** One call whose reply must be JSON matching `schema`; one retry, told what was wrong. */
export async function askJson<S extends z.ZodType>(scope: AiScope, kind: AiKind, schema: S, system: string, user: string): Promise<z.output<S>> {
  const first = parseAiJson(schema, await askText(scope, kind, system, user));
  if (first.ok) return first.data;
  const retry = `${user}\n\nYour previous reply couldn’t be used (${first.error}). Reply again with ONLY the JSON, in exactly the format above.`;
  const second = parseAiJson(schema, await askText(scope, kind, system, retry));
  if (second.ok) return second.data;
  console.error('AI reply invalid twice', kind, second.error);
  throw new ApiError(502, 'ai_bad_output', 'The coach’s answer came back unreadable twice. Try again in a moment.');
}

/**
 * A streamed answer. The provider's event stream goes to the phone as it is (the app reads the
 * text deltas of either format), so the Worker spends almost no CPU per token. A copy is scanned
 * at the end for the tokens and cost, which settle the reservation.
 */
export async function askStream(
  scope: AiScope,
  kind: AiKind,
  system: string,
  user: string,
): Promise<{ body: ReadableStream<Uint8Array>; done: Promise<void> }> {
  const setup = requireAi(scope);
  const model = modelFor(setup, kind, await checkBudget(scope));
  const reservation = await reserve(scope, kind, model, system, user);
  let upstream: Response;
  try {
    upstream =
      setup.provider === 'openrouter'
        ? await openRouterStream(setup.key, chatBody(model, kind, system, user))
        : await anthropic(setup.key).messages.create({ ...anthropicParams(model, kind, system, user), stream: true }).asResponse();
  } catch (err) {
    if (refusedByApi(err)) await release(scope, reservation);
    throw toApiError(err);
  }
  if (!upstream.body) throw toApiError(new ProviderStreamError('empty stream'));
  const [toPhone, toMeter] = upstream.body.tee();
  // A stream that breaks off before reporting its usage keeps the worst-case reservation.
  const done = readAll(toMeter)
    .then((text) => {
      const spent = spentFromStream(setup, text);
      return spent ? settle(scope, reservation, model, spent) : undefined;
    })
    .catch((err: unknown) => console.error('AI stream metering failed', err instanceof Error ? err.message : String(err)));
  return { body: toPhone, done };
}

/** Tokens and cost reported at the end of a stream, in either provider's format. */
function spentFromStream(setup: AiSetup, text: string): Spent | null {
  if (setup.provider === 'openrouter') {
    const usage = chatStreamUsage(text);
    return usage ? { input: usage.prompt_tokens, output: usage.completion_tokens, cost: usage.cost } : null;
  }
  const u = usageFromEvents(text);
  if (u.input_tokens <= 0) return null;
  return { input: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), output: u.output_tokens, cost: null };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
