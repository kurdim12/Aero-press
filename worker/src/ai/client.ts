// Every AI call goes through here: budget check first, then the Anthropic API (from the Worker
// only; the key never reaches the browser), then tokens and cost logged in ai_calls.
import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import type { AuthMember } from '../env';
import { ApiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { type AiKind, EFFORT, MAX_TOKENS, MODELS, costUsd, monthStart } from './config';
import { type Usage, parseAiJson, usageFromEvents } from './json';

/** Tests swap the network for canned replies (and supply a key); production never sets these. */
export const aiTransport: { fetch?: typeof fetch; apiKey?: string } = {};

/** The Anthropic key: the Wrangler secret ANTHROPIC_API_KEY. */
export const aiKey = (env: { ANTHROPIC_API_KEY?: string }): string | undefined => env.ANTHROPIC_API_KEY ?? aiTransport.apiKey;

export interface AiScope {
  db: D1Database;
  apiKey: string | undefined;
  member: AuthMember;
}

function client(apiKey: string | undefined): Anthropic {
  if (!apiKey) {
    throw new ApiError(503, 'ai_not_configured', 'The AI coach isn’t set up yet. The owner needs to add the Anthropic API key in Cloudflare (see the README).');
  }
  return new Anthropic({ apiKey, fetch: aiTransport.fetch, maxRetries: 1, timeout: 90_000 });
}

export async function monthSpend(db: D1Database, teamId: string): Promise<{ spent: number; calls: number; cap: number }> {
  const [team, usage] = await Promise.all([
    db.prepare('SELECT ai_monthly_budget_usd AS cap FROM teams WHERE id = ?').bind(teamId).first<{ cap: number }>(),
    db
      .prepare('SELECT COALESCE(SUM(cost_usd), 0) AS spent, COUNT(*) AS calls FROM ai_calls WHERE team_id = ? AND created_at >= ?')
      .bind(teamId, monthStart())
      .first<{ spent: number; calls: number }>(),
  ]);
  return { spent: usage?.spent ?? 0, calls: usage?.calls ?? 0, cap: team?.cap ?? 0 };
}

/** Before every call: stop once the month's spend reaches the owner's cap. */
export async function assertBudget(db: D1Database, teamId: string): Promise<void> {
  const { spent, cap } = await monthSpend(db, teamId);
  if (spent >= cap) {
    throw new ApiError(402, 'ai_budget_exceeded', 'AI budget for this month is used up. The owner can raise it in Settings.');
  }
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
async function reserve(scope: AiScope, kind: AiKind, system: string, user: string): Promise<string> {
  const model = MODELS[kind];
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

async function settle(scope: AiScope, id: string, kind: AiKind, usage: Usage): Promise<void> {
  const input = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  await scope.db
    .prepare('UPDATE ai_calls SET input_tokens = ?, output_tokens = ?, cost_usd = ? WHERE id = ? AND team_id = ?')
    .bind(input, usage.output_tokens, costUsd(MODELS[kind], input, usage.output_tokens), id, scope.member.team_id)
    .run();
}

/** The API turned the request away with an HTTP error, so nothing was billed. */
const refusedByApi = (err: unknown) => err instanceof Anthropic.APIError && typeof err.status === 'number';

async function release(scope: AiScope, id: string): Promise<void> {
  await scope.db.prepare('DELETE FROM ai_calls WHERE id = ? AND team_id = ?').bind(id, scope.member.team_id).run();
}

/** Anthropic's errors, in words the team can act on. Retryable ones say "try again". */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new ApiError(503, 'ai_key_invalid', 'The Anthropic API key was refused. The owner needs to check it in Cloudflare.');
  }
  if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
    return new ApiError(503, 'ai_busy', 'The AI coach is busy right now. Try again in a minute.');
  }
  if (err instanceof Anthropic.APIError && err.status === 402) {
    return new ApiError(503, 'ai_billing', 'The Anthropic account can’t take requests right now (billing). The owner needs to check it.');
  }
  console.error('AI call failed', err instanceof Error ? err.message : String(err));
  return new ApiError(502, 'ai_failed', 'The AI coach couldn’t answer. Try again; if it keeps happening, tell the owner.');
}

function params(kind: AiKind, system: string, user: string) {
  const effort = EFFORT[kind];
  return {
    model: MODELS[kind],
    max_tokens: MAX_TOKENS[kind],
    system,
    messages: [{ role: 'user' as const, content: user }],
    ...(effort ? { output_config: { effort } } : {}),
  };
}

/**
 * One call, text back. It streams under the hood: the SDK's timeout only covers the wait for the
 * first bytes, so a long answer is never cut off (and then paid for again by a retry).
 */
export async function askText(scope: AiScope, kind: AiKind, system: string, user: string): Promise<string> {
  await assertBudget(scope.db, scope.member.team_id);
  const anthropic = client(scope.apiKey);
  const reservation = await reserve(scope, kind, system, user);
  let message: Anthropic.Message;
  try {
    message = await anthropic.messages.stream(params(kind, system, user)).finalMessage();
  } catch (err) {
    if (refusedByApi(err)) await release(scope, reservation);
    throw toApiError(err);
  }
  await settle(scope, reservation, kind, message.usage);
  if (message.stop_reason === 'refusal') {
    throw new ApiError(422, 'ai_refused', 'The coach couldn’t answer that one. Try asking another way.');
  }
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
 * A streamed answer. Anthropic's event stream goes to the phone as it is (the app reads the text
 * deltas), so the Worker spends almost no CPU per token. A copy is scanned at the end for the
 * token counts, which are logged once the stream finishes.
 */
export async function askStream(
  scope: AiScope,
  kind: AiKind,
  system: string,
  user: string,
): Promise<{ body: ReadableStream<Uint8Array>; done: Promise<void> }> {
  await assertBudget(scope.db, scope.member.team_id);
  const anthropic = client(scope.apiKey);
  const reservation = await reserve(scope, kind, system, user);
  let upstream: Response;
  try {
    upstream = await anthropic.messages.create({ ...params(kind, system, user), stream: true }).asResponse();
  } catch (err) {
    if (refusedByApi(err)) await release(scope, reservation);
    throw toApiError(err);
  }
  if (!upstream.body) throw toApiError(new Error('empty stream'));
  const [toPhone, toMeter] = upstream.body.tee();
  // A stream that breaks off before reporting its usage keeps the worst-case reservation.
  const done = meterStream(toMeter)
    .then((usage) => (usage.input_tokens > 0 ? settle(scope, reservation, kind, usage) : undefined))
    .catch((err: unknown) => console.error('AI stream metering failed', err instanceof Error ? err.message : String(err)));
  return { body: toPhone, done };
}

/** Token counts from a Messages event stream: message_start has the input, the last message_delta the output. */
export async function meterStream(stream: ReadableStream<Uint8Array>): Promise<Usage> {
  const decoder = new TextDecoder();
  let text = '';
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return usageFromEvents(text);
}
