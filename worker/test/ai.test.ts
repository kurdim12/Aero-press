import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AiUsage,
  BrewRow,
  DuelReadResponse,
  DuelView,
  ExperimentsResponse,
  QuickLogResponse,
  ReadinessReport,
  RecipeRow,
  TodayResponse,
} from '../../shared/types';
import { aiTransport } from '../src/ai/client';
import { TEAM_PIN, addBarista, freshDb, recipeBody, setupTeam, signIn } from './helpers';

// A fake Anthropic API: each call takes the next queued reply and is recorded.
type Reply = (body: Record<string, unknown>) => Response;
let replies: Reply[] = [];
let requests: Record<string, unknown>[] = [];

/** A Messages event stream, the way the API sends one. */
function eventStream(chunks: string[], usage: { input_tokens: number; output_tokens: number }, model: string): Response {
  const events = [
    ['message_start', { type: 'message_start', message: { id: 'msg_s', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: usage.input_tokens, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ...chunks.map((text) => ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }]),
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: usage.output_tokens } }],
    ['message_stop', { type: 'message_stop' }],
  ] as const;
  const text = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** A reply with this text (streamed, since the Worker streams every call). `model` is what the API says it served. */
const message = (text: string, usage = { input_tokens: 2000, output_tokens: 500 }, model?: string): Reply => (body) =>
  eventStream([text], usage, model ?? String(body.model));

const apiError = (status: number, type: string): Reply => () =>
  new Response(JSON.stringify({ type: 'error', error: { type, message: 'nope' } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const sse = (chunks: string[], usage = { input_tokens: 900, output_tokens: 42 }): Reply => () => eventStream(chunks, usage, 'claude-sonnet-5');

beforeEach(async () => {
  await freshDb();
  replies = [];
  requests = [];
  aiTransport.apiKey = 'test-key';
  aiTransport.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    requests.push(body);
    const next = replies.shift();
    if (!next) throw new Error('unexpected AI call');
    return next(body);
  };
});

afterEach(() => {
  aiTransport.apiKey = undefined;
  aiTransport.fetch = undefined;
});

const experiment = (parent: string, changes: Record<string, unknown>) => ({
  title: `Try ${Object.keys(changes).join(', ')}`,
  parent,
  changes,
  why: 'The data says so.',
  listenFor: 'Sweetness as it cools.',
});

async function teamWithRecipes() {
  const { owner, me } = await setupTeam();
  const bean = (await owner.post<{ id: string }>('/api/beans', { name: 'Ethiopia Guji', origin: 'Ethiopia' })).body;
  const r1 = (await owner.post<RecipeRow>('/api/recipes', recipeBody({ name: 'Base', bean_id: bean.id }))).body;
  const r2 = (await owner.post<RecipeRow>('/api/recipes', recipeBody({ name: 'Cooler', temp_c: 86, bean_id: bean.id }))).body;
  return { owner, me, bean, r1, r2 };
}

const spendRows = () => env.DB.prepare('SELECT kind, model, input_tokens, output_tokens, cost_usd FROM ai_calls ORDER BY created_at').all();

describe('coach: plan and adapt', () => {
  it('plans three experiments, resolves parents, logs tokens and cost', async () => {
    const { owner, r1 } = await teamWithRecipes();
    replies.push(
      message(
        JSON.stringify({
          read: 'Thin data so far.',
          experiments: [
            experiment(r1.display_code, { temp_c: 88, unknown_key: 1, dose_g: 18, method: 'Inverted' }),
            experiment('r1', { press_duration_s: 25 }),
            experiment('XX-R9', { dose_g: 17 }),
          ],
        }),
      ),
    );
    const res = await owner.post<ExperimentsResponse>('/api/coach/plan', {});
    expect(res.status).toBe(200);
    expect(res.body.experiments).toHaveLength(3);
    expect(res.body.experiments[0]).toMatchObject({ parent: r1.display_code, parent_id: r1.id, changes: { temp_c: 88 } });
    expect(res.body.experiments[0]?.changes).not.toHaveProperty('unknown_key');
    // "Changes" to the parent's own values are dropped.
    expect(res.body.experiments[0]?.changes).toEqual({ temp_c: 88 });
    expect(res.body.experiments[1]?.parent_id).toBe(r1.id); // bare "R1" matched
    expect(res.body.experiments[2]).toMatchObject({ parent: 'XX-R9', parent_id: null });

    // The request went to the coach model with the spec's system prompt and the team's data.
    const request = requests[0]!;
    expect(request.model).toBe('claude-sonnet-5');
    expect(String(request.system)).toContain('World AeroPress Championship coach');
    expect(JSON.stringify(request.messages)).toContain(r1.display_code);
    const rows = (await spendRows()).results;
    expect(rows).toEqual([{ kind: 'plan', model: 'claude-sonnet-5', input_tokens: 2000, output_tokens: 500, cost_usd: 0.009 }]);
  });

  it('retries once on an invalid reply, then gives a clear error', async () => {
    const { owner, r1 } = await teamWithRecipes();
    const good = JSON.stringify({ read: 'ok', experiments: [1, 2, 3].map(() => experiment(r1.display_code, { temp_c: 90 })) });
    replies.push(message('Here are two ideas: ...'), message(good));
    expect((await owner.post('/api/coach/plan', {})).status).toBe(200);
    expect(String(JSON.stringify(requests[1]))).toContain('couldn’t be used');

    replies.push(message('nope'), message('{"read": "still wrong"}'));
    const bad = await owner.post('/api/coach/plan', {});
    expect(bad.status).toBe(502);
    expect(bad.body.error.code).toBe('ai_bad_output');
    expect((await spendRows()).results).toHaveLength(4); // every call is paid for, and logged
  });

  it('adapts a recipe to a new coffee: parent and bean are set for every version', async () => {
    const { owner, r1 } = await teamWithRecipes();
    const kenya = (await owner.post<{ id: string }>('/api/beans', { name: 'Kenya Nyeri' })).body;
    replies.push(
      message(JSON.stringify({ read: 'Denser coffee.', experiments: [1, 2, 3].map((n) => experiment('whatever', { temp_c: 90 + n })) })),
    );
    const res = await owner.post<ExperimentsResponse>('/api/coach/adapt', { bean_id: kenya.id, recipe_id: r1.id });
    expect(res.status).toBe(200);
    for (const e of res.body.experiments) expect(e).toMatchObject({ parent_id: r1.id, changes: { bean_id: kenya.id } });
    expect(JSON.stringify(requests[0])).toContain('Kenya Nyeri');
  });
});

describe('budget cap', () => {
  it('blocks every AI call once the month’s spend reaches the cap, without calling the API', async () => {
    const { owner } = await teamWithRecipes();
    await env.DB.prepare('UPDATE teams SET ai_monthly_budget_usd = 0.05').run();
    const team = await env.DB.prepare('SELECT id FROM teams').first<{ id: string }>();
    const member = await env.DB.prepare("SELECT id FROM members WHERE role = 'owner'").first<{ id: string }>();
    await env.DB.prepare(
      `INSERT INTO ai_calls (id, team_id, member_id, kind, model, input_tokens, output_tokens, cost_usd, created_at)
       VALUES ('c1', ?, ?, 'plan', 'claude-sonnet-5', 10000, 3000, 0.05, ?)`,
    )
      .bind(team?.id, member?.id, Date.now())
      .run();
    for (const [path, body] of [
      ['/api/coach/plan', {}],
      ['/api/coach/readiness', {}],
      ['/api/coach/today', {}],
      ['/api/coach/ask', { question: 'Why?' }],
      ['/api/coach/quick-log', { text: 'R1, TDS 1.3' }],
    ] as const) {
      const res = await owner.post(path, body);
      expect(res.status, path).toBe(402);
      expect(res.body.error).toMatchObject({
        code: 'ai_budget_exceeded',
        message: 'AI budget for this month is used up. The owner can raise it in Settings.',
      });
    }
    expect(requests).toHaveLength(0);
    const usage = (await owner.get<AiUsage>('/api/coach/usage')).body;
    expect(usage).toEqual({ configured: true, month_spend_usd: 0.05, cap_usd: 0.05, calls: 1 });

    // Last month's spend doesn't count.
    await env.DB.prepare('UPDATE ai_calls SET created_at = ?').bind(Date.now() - 40 * 86_400_000).run();
    replies.push(message(JSON.stringify({ verdict: 'close', biggestRisk: 'x', fixes: ['a', 'b', 'c'], evidence: 'y' })));
    expect((await owner.post('/api/coach/readiness', {})).status).toBe(200);
  });

  it('says plainly when the key is missing, and when the API is busy', async () => {
    const { owner } = await teamWithRecipes();
    aiTransport.apiKey = undefined;
    const missing = await owner.post('/api/coach/plan', {});
    expect(missing.status).toBe(503);
    expect(missing.body.error.code).toBe('ai_not_configured');
    expect((await owner.get<AiUsage>('/api/coach/usage')).body.configured).toBe(false);

    aiTransport.apiKey = 'test-key';
    replies.push(apiError(529, 'overloaded_error'), apiError(529, 'overloaded_error'));
    const busy = await owner.post('/api/coach/readiness', {});
    expect(busy.status).toBe(503);
    expect(busy.body.error.code).toBe('ai_busy');
    // The API turned it away, so nothing was billed and nothing counts toward the budget.
    expect((await spendRows()).results).toEqual([]);
  });

  it('counts a call that never answers at its worst case, and prices by the model asked for', async () => {
    const { owner } = await teamWithRecipes();
    const hangUp: Reply = () => {
      throw new TypeError('network connection lost');
    };
    replies.push(hangUp, hangUp);
    const lost = await owner.post('/api/coach/plan', {});
    expect(lost.status).toBe(503);
    const kept = (await spendRows()).results as { output_tokens: number; cost_usd: number }[];
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ output_tokens: 8000 });
    expect(kept[0]!.cost_usd).toBeGreaterThan(0.08);

    // A reply naming a model the price list doesn't know is still priced as the model we asked for.
    await env.DB.prepare('DELETE FROM ai_calls').run();
    replies.push(message(JSON.stringify({ verdict: 'close', biggestRisk: 'x', fixes: ['a', 'b', 'c'], evidence: 'y' }), { input_tokens: 1000, output_tokens: 100 }, 'claude-sonnet-5-20991231'));
    expect((await owner.post('/api/coach/readiness', {})).status).toBe(200);
    expect((await spendRows()).results).toEqual([{ kind: 'readiness', model: 'claude-sonnet-5', input_tokens: 1000, output_tokens: 100, cost_usd: 0.003 }]);
  });
});

describe('coach: readiness, today and ask', () => {
  it('stores readiness reports and returns the latest', async () => {
    const { owner } = await teamWithRecipes();
    expect((await owner.get<{ report: ReadinessReport | null }>('/api/coach/readiness')).body.report).toBeNull();
    replies.push(message(JSON.stringify({ verdict: 'not ready', biggestRisk: 'No locked recipe.', fixes: ['Lock', 'Duel', 'Time'], evidence: '0 duels.' })));
    const made = (await owner.post<{ report: ReadinessReport }>('/api/coach/readiness', {})).body.report;
    expect(made).toMatchObject({ verdict: 'not ready', fixes: ['Lock', 'Duel', 'Time'], member_name: 'Abdelrahman Kurdi' });
    expect((await owner.get<{ report: ReadinessReport }>('/api/coach/readiness')).body.report.id).toBe(made.id);
  });

  it('skips today’s session (and the AI call) until the team has two recipes', async () => {
    const { owner } = await setupTeam();
    await owner.post('/api/recipes', recipeBody({ name: 'Only one' }));
    const res = await owner.post<TodayResponse>('/api/coach/today');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ session: null, needs_recipes: true });
    expect(requests).toHaveLength(0);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM coach_cache').first<{ n: number }>())?.n).toBe(0);
  });

  it('writes today’s card once, however many tabs ask, and frees a failed claim', async () => {
    const { owner, me, r1, r2 } = await teamWithRecipes();
    const day = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
    const claim = (ms: number) =>
      env.DB.prepare(`INSERT INTO coach_cache (team_id, member_id, kind, day, result_json, created_at) VALUES (?, ?, 'today', ?, ?, ?)`)
        .bind(me.team.id, me.member.id, day, `pending:${ms}`, ms)
        .run();

    // Another tab is writing it: this one waits, and nothing is called.
    await claim(Date.now());
    expect((await owner.post<TodayResponse>('/api/coach/today', {})).body).toEqual({ session: null, pending: true });
    expect((await owner.get<TodayResponse>('/api/coach/today')).body).toEqual({ session: null, pending: true });
    expect(requests).toHaveLength(0);

    // A claim left behind by a writer that died is taken over.
    await env.DB.prepare('DELETE FROM coach_cache').run();
    await claim(Date.now() - 7 * 60_000);
    replies.push(message(JSON.stringify({ summary: 'Settle it.', duels: [{ a: r1.display_code, b: r2.display_code, why: 'Close.' }] })));
    expect((await owner.post<TodayResponse>('/api/coach/today', {})).body.session?.summary).toBe('Settle it.');
    expect(requests).toHaveLength(1);

    // Two tabs at once: still one call, and each gets the card or waits for it.
    await env.DB.prepare('DELETE FROM coach_cache').run();
    replies.push(message(JSON.stringify({ summary: 'Again.', duels: [] })));
    const both = await Promise.all([owner.post<TodayResponse>('/api/coach/today', {}), owner.post<TodayResponse>('/api/coach/today', {})]);
    expect(requests).toHaveLength(2);
    for (const res of both) expect(res.body.session?.summary === 'Again.' || res.body.pending === true).toBe(true);

    // A write that fails leaves nothing behind, so a later attempt can try again.
    await env.DB.prepare('DELETE FROM coach_cache').run();
    replies.push(apiError(400, 'invalid_request_error'));
    expect((await owner.post('/api/coach/today', {})).status).toBe(502);
    expect((await owner.get<TodayResponse>('/api/coach/today')).body).toEqual({ session: null });
  });

  it('writes today’s session once per member per day', async () => {
    const { owner, r1, r2 } = await teamWithRecipes();
    expect((await owner.get<TodayResponse>('/api/coach/today')).body.session).toBeNull();
    replies.push(message(JSON.stringify({ summary: 'Settle R1 vs R2.', duels: [{ a: r1.display_code, b: r2.display_code, why: 'Unproven.' }] })));
    const first = (await owner.post<TodayResponse>('/api/coach/today', {})).body.session;
    expect(first?.duels[0]).toMatchObject({ a_id: r1.id, b_id: r2.id });
    const again = (await owner.post<TodayResponse>('/api/coach/today', {})).body.session;
    expect(again).toEqual(first);
    expect(requests).toHaveLength(1);
    // Each member gets their own card.
    const linaId = await addBarista(owner, 'Lina Haddad');
    const lina = (await signIn(linaId, TEAM_PIN)).client;
    expect((await lina.get<TodayResponse>('/api/coach/today')).body.session).toBeNull();
  });

  it('streams an answer and logs its tokens when it finishes', async () => {
    const { owner } = await teamWithRecipes();
    replies.push(sse(['Brew ', 'cooler.']));
    const res = await exports.default.fetch(
      new Request(`${owner.origin}/api/coach/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({ question: 'What should I try next?' }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    // The phone gets Anthropic's events as they are and reads the text deltas.
    const text = await res.text();
    const deltas = [...text.matchAll(/"text_delta","text":"([^"]*)"/g)].map((m) => m[1]).join('');
    expect(deltas).toBe('Brew cooler.');
    await vi.waitFor(async () => {
      const rows = (await spendRows()).results;
      expect(rows).toEqual([{ kind: 'ask', model: 'claude-sonnet-5', input_tokens: 900, output_tokens: 42, cost_usd: 0.00222 }]);
    });
    expect(JSON.stringify(requests[0])).toContain('What should I try next?');
    expect((await owner.post('/api/coach/ask', { question: '  ' })).body.error.field).toBe('question');
  });
});

describe('quick log', () => {
  it('fills the brew fields it can, matches recipe and bean, and leaves the rest empty', async () => {
    const { owner, bean, r1 } = await teamWithRecipes();
    replies.push(
      message(
        JSON.stringify({
          grind_used: null,
          total_time_s: 170,
          tds_pct: 1.32,
          beverage_g: 245,
          sweetness: null,
          acidity: null,
          body: null,
          clarity: null,
          finish: null,
          overall: 7.5,
          notes: 'sweet but thin when cool',
          recipeMatch: { id: r1.id, confidence: 0.92 },
          beanMatch: { id: 'not-a-team-bean', confidence: 0.6 },
        }),
        { input_tokens: 600, output_tokens: 120 },
      ),
    );
    const res = await owner.post<QuickLogResponse>('/api/coach/quick-log', { text: `${r1.code} on Guji, TDS 1.32, 245 grams, sweet but thin when cool` });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      recipe_id: r1.id,
      bean_id: null,
      tds_pct: 1.32,
      beverage_g: 245,
      total_time_s: 170,
      overall: 7.5,
      sweetness: null,
      recipeMatch: { id: r1.id, confidence: 0.92 },
      beanMatch: { id: null, confidence: 0 },
    });
    expect(requests[0]?.model).toBe('claude-haiku-4-5-20251001');
    expect(JSON.stringify(requests[0])).toContain(bean.id);
  });
});

describe('automatic reads', () => {
  it('writes a two-sentence read after a brew is saved', async () => {
    const { owner, r1 } = await teamWithRecipes();
    replies.push(message('TDS 1.32 sits right on the average. Overall 7.5 is your best yet.', { input_tokens: 400, output_tokens: 40 }));
    const brew = (await owner.post<BrewRow>('/api/brews', { recipe_id: r1.id, tds_pct: 1.32, beverage_g: 245, overall: 7.5 })).body;
    await vi.waitFor(async () => {
      const row = await env.DB.prepare('SELECT ai_read FROM brews WHERE id = ?').bind(brew.id).first<{ ai_read: string | null }>();
      expect(row?.ai_read).toContain('best yet');
    });
    expect(requests[0]?.model).toBe('claude-haiku-4-5-20251001');
  });

  it('writes a duel read once, after the reveal, for every phone', async () => {
    const { owner, r1, r2 } = await teamWithRecipes();
    const linaId = await addBarista(owner, 'Lina Haddad');
    const lina = (await signIn(linaId, TEAM_PIN)).client;
    const duel = (await owner.post<DuelView>('/api/duels', { recipe_a_id: r1.id, recipe_b_id: r2.id, judge_ids: [linaId] })).body;
    expect((await lina.post(`/api/duels/${duel.id}/read`)).status).toBe(409);
    await owner.post(`/api/duels/${duel.id}/ready`);
    await lina.post(`/api/duels/${duel.id}/vote`, { choice: 'x' });

    const winner = duel.x!;
    replies.push(message(JSON.stringify({ read: `${winner.display_code} won 1-0.`, next_test: experiment(winner.display_code, { temp_c: 89 }) })));
    const first = await lina.post<DuelReadResponse>(`/api/duels/${duel.id}/read`);
    expect(first.body.read?.next_test).toMatchObject({ parent_id: winner.id, changes: { temp_c: 89 } });
    const again = await owner.post<DuelReadResponse>(`/api/duels/${duel.id}/read`);
    expect(again.body.read?.read).toBe(`${winner.display_code} won 1-0.`);
    expect(requests).toHaveLength(1);
    expect((await owner.get<DuelView>(`/api/duels/${duel.id}`)).body.ai_read?.read).toContain('won');

    // While one phone is writing it, the others are told to wait.
    const duel2 = (await owner.post<DuelView>('/api/duels', { recipe_a_id: r1.id, recipe_b_id: r2.id, judge_ids: [linaId] })).body;
    await owner.post(`/api/duels/${duel2.id}/ready`);
    await lina.post(`/api/duels/${duel2.id}/vote`, { choice: 'tie' });
    await env.DB.prepare('UPDATE duels SET ai_read = ? WHERE id = ?').bind(`pending:${Date.now()}`, duel2.id).run();
    const waiting = await lina.post<DuelReadResponse>(`/api/duels/${duel2.id}/read`);
    expect(waiting.status).toBe(202);
    expect(waiting.body).toEqual({ read: null, pending: true });
  });
});

