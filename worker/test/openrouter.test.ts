import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiUsage, CompareResponse, ExperimentsResponse, QuickLogResponse, RecipeRow, RecipeTipsResponse, TeamSettings } from '../../shared/types';
import { aiTransport } from '../src/ai/client';
import { OPENROUTER_URL } from '../src/ai/openrouter';
import { freshDb, recipeBody, setupTeam } from './helpers';

// A fake OpenRouter: each call takes the next queued reply, and the request is recorded.
type Reply = (body: Record<string, unknown>) => Response;
let replies: Reply[] = [];
let calls: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];

interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  cost: number;
}

/** A chat-completions event stream as OpenRouter sends it: keep-alive comment, deltas, usage, [DONE]. */
function chatStream(chunks: string[], usage: Usage, finish = 'stop', model = 'google/gemini-3.8-flash'): Response {
  const chunk = (delta: Record<string, unknown>, finishReason: string | null, extra: Record<string, unknown> = {}) =>
    `data: ${JSON.stringify({ id: 'gen-1', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta, finish_reason: finishReason }], ...extra })}\n\n`;
  const text = [
    ': OPENROUTER PROCESSING\n\n',
    ...chunks.map((content) => chunk({ role: 'assistant', content }, null)),
    chunk({}, finish),
    chunk({}, finish, { usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens } }),
    'data: [DONE]\n\n',
  ].join('');
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const reply = (text: string, usage: Usage = { prompt_tokens: 3000, completion_tokens: 700, cost: 0.0049 }): Reply => () =>
  // Split the answer so the Worker has to put it back together.
  chatStream([text.slice(0, 20), text.slice(20)], usage);

const httpError = (status: number, message: string): Reply => () =>
  new Response(JSON.stringify({ error: { code: status, message } }), { status, headers: { 'content-type': 'application/json' } });

beforeEach(async () => {
  await freshDb();
  replies = [];
  calls = [];
  aiTransport.openRouterKey = 'or-test-key';
  aiTransport.apiKey = 'anthropic-test-key'; // both set: OpenRouter wins
  aiTransport.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const headers = new Headers(init?.headers);
    calls.push({ url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, auth: headers.get('authorization'), body });
    const next = replies.shift();
    if (!next) throw new Error('unexpected AI call');
    return next(body);
  };
});

afterEach(() => {
  aiTransport.openRouterKey = undefined;
  aiTransport.apiKey = undefined;
  aiTransport.fetch = undefined;
});

const plan = (parent: string) =>
  JSON.stringify({
    read: 'Thin data so far.',
    experiments: [1, 2, 3].map((i) => ({ title: `Try ${i}`, parent, changes: { temp_c: 86 + i }, why: 'Sweeter.', listenFor: 'Sweetness.' })),
  });

const spendRows = () => env.DB.prepare('SELECT kind, model, input_tokens, output_tokens, cost_usd FROM ai_calls ORDER BY created_at').all();

async function team() {
  const { owner } = await setupTeam();
  const r1 = (await owner.post<RecipeRow>('/api/recipes', recipeBody({ name: 'Base' }))).body;
  await owner.post<RecipeRow>('/api/recipes', recipeBody({ name: 'Cooler', temp_c: 86 }));
  return { owner, r1 };
}

const settings = (over: Partial<TeamSettings> = {}) => ({
  name: 'Kurdi Coffee Lab',
  champ_name: null,
  champ_date: null,
  comp_coffee_notes: null,
  ai_monthly_budget_usd: 10,
  ...over,
});

describe('OpenRouter', () => {
  it('is used when its key is set, with the default model, and the budget counts what it charged', async () => {
    const { owner, r1 } = await team();
    replies.push(reply(plan(r1.display_code)));
    const res = await owner.post<ExperimentsResponse>('/api/coach/plan', {});
    expect(res.status).toBe(200);
    expect(res.body.experiments).toHaveLength(3);
    expect(res.body.experiments[0]).toMatchObject({ parent_id: r1.id, changes: { temp_c: 87 } });

    const call = calls[0]!;
    expect(call.url).toBe(OPENROUTER_URL);
    expect(call.auth).toBe('Bearer or-test-key');
    expect(call.body).toMatchObject({ model: 'google/gemini-3.8-flash', stream: true, max_tokens: 8000, reasoning: { effort: 'medium', exclude: true } });
    const messages = call.body.messages as { role: string; content: string }[];
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(messages[0]!.content).toContain('World AeroPress Championship');
    // The reference goes to either provider.
    expect(messages[0]!.content).toContain('## Water temperature');

    // Settled from OpenRouter's own figures, not the price list.
    expect((await spendRows()).results).toEqual([{ kind: 'plan', model: 'google/gemini-3.8-flash', input_tokens: 3000, output_tokens: 700, cost_usd: 0.0049 }]);
    const usage = (await owner.get<AiUsage>('/api/coach/usage')).body;
    expect(usage).toMatchObject({ configured: true, provider: 'openrouter', models: { coach: 'google/gemini-3.8-flash', quick: 'google/gemini-3.8-flash' } });
  });

  it('uses the models the owner picks in Settings, per role', async () => {
    const { owner, r1 } = await team();
    const saved = await owner.put<TeamSettings>(
      '/api/team',
      settings({ ai_coach_model: 'deepseek/deepseek-v4-pro-0813', ai_quick_model: 'deepseek/deepseek-v4.1-flash' }),
    );
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ ai_coach_model: 'deepseek/deepseek-v4-pro-0813', ai_quick_model: 'deepseek/deepseek-v4.1-flash' });

    replies.push(reply(plan(r1.display_code)));
    expect((await owner.post('/api/coach/plan', {})).status).toBe(200);
    expect(calls[0]!.body.model).toBe('deepseek/deepseek-v4-pro-0813');

    replies.push(
      reply(
        JSON.stringify({
          grind_used: null, total_time_s: 160, tds_pct: 1.34, beverage_g: 238, sweetness: null, acidity: null, body: null,
          clarity: null, finish: null, overall: 8, notes: 'sweet', recipeMatch: { id: r1.id, confidence: 0.9 }, beanMatch: { id: null, confidence: 0 },
        }),
        { prompt_tokens: 900, completion_tokens: 120, cost: 0.0001 },
      ),
    );
    const quick = await owner.post<QuickLogResponse>('/api/coach/quick-log', { text: 'R1 1.34 238g 2:40 overall 8, sweet' });
    expect(quick.status).toBe(200);
    expect(quick.body).toMatchObject({ recipe_id: r1.id, tds_pct: 1.34, total_time_s: 160, overall: 8 });
    expect(calls[1]!.body).toMatchObject({ model: 'deepseek/deepseek-v4.1-flash', reasoning: { effort: 'low' } });
    expect((await owner.get<AiUsage>('/api/coach/usage')).body.models).toEqual({ coach: 'deepseek/deepseek-v4-pro-0813', quick: 'deepseek/deepseek-v4.1-flash' });

    // Only models on the list; leaving the picks out keeps them.
    const bad = await owner.put('/api/team', settings({ ai_coach_model: 'someone/unknown-model' }));
    expect(bad.status).toBe(400);
    expect(bad.body.error.field).toBe('ai_coach_model');
    expect((await owner.put<TeamSettings>('/api/team', settings())).body.ai_coach_model).toBe('deepseek/deepseek-v4-pro-0813');
  });

  it('offers GPT-6 Sol and Luna, and sends their OpenRouter ids', async () => {
    const { owner, r1 } = await team();
    const saved = await owner.put<TeamSettings>('/api/team', settings({ ai_coach_model: 'openai/gpt-6-sol', ai_quick_model: 'openai/gpt-6-luna' }));
    expect(saved.status).toBe(200);
    replies.push(reply(plan(r1.display_code)));
    expect((await owner.post('/api/coach/plan', {})).status).toBe(200);
    expect(calls[0]!.body).toMatchObject({ model: 'openai/gpt-6-sol', reasoning: { effort: 'medium', exclude: true } });
    expect((await owner.get<AiUsage>('/api/coach/usage')).body.models).toEqual({ coach: 'openai/gpt-6-sol', quick: 'openai/gpt-6-luna' });
  });

  it('turns OpenRouter errors into plain messages and only counts calls that may have been billed', async () => {
    const { owner } = await team();
    replies.push(httpError(401, 'No auth credentials found'));
    const badKey = await owner.post('/api/coach/readiness', {});
    expect(badKey.status).toBe(503);
    expect(badKey.body.error.code).toBe('ai_key_invalid');

    replies.push(httpError(402, 'Insufficient credits'));
    expect((await owner.post('/api/coach/readiness', {})).body.error.code).toBe('ai_billing');

    replies.push(httpError(429, 'Rate limited'));
    expect((await owner.post('/api/coach/readiness', {})).body.error.code).toBe('ai_busy');
    // Turned away before any work: nothing billed, nothing counted.
    expect((await spendRows()).results).toEqual([]);

    // Broke off mid-answer: the provider may have billed it, so the worst case stays counted.
    replies.push(() => {
      const text = `data: ${JSON.stringify({ choices: [{ delta: { content: '{"verdict":' } }] })}\n\ndata: ${JSON.stringify({ error: { message: 'upstream overloaded' }, choices: [{ delta: {}, finish_reason: 'error' }] })}\n\ndata: [DONE]\n\n`;
      return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    const broken = await owner.post('/api/coach/readiness', {});
    expect(broken.status).toBe(503);
    expect(broken.body.error.code).toBe('ai_busy');
    const kept = (await spendRows()).results as { output_tokens: number; model: string }[];
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ model: 'google/gemini-3.8-flash', output_tokens: 6000 });
  });

  it('streams answers straight to the phone and logs the cost when they finish', async () => {
    const { owner } = await team();
    replies.push(() => chatStream(['Brew ', 'cooler.'], { prompt_tokens: 1200, completion_tokens: 40, cost: 0.00105 }));
    const res = await exports.default.fetch(
      new Request(`${owner.origin}/api/coach/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({ question: 'What should I try next?' }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    const deltas = [...text.matchAll(/"content":"([^"]*)"/g)].map((m) => m[1]).join('');
    expect(deltas).toBe('Brew cooler.');
    await vi.waitFor(async () => {
      expect((await spendRows()).results).toEqual([{ kind: 'ask', model: 'google/gemini-3.8-flash', input_tokens: 1200, output_tokens: 40, cost_usd: 0.00105 }]);
    });
  });

  it('writes recipe tips and comparisons with the owner’s coach model, thinking little', async () => {
    const { owner, r1 } = await team();
    await owner.put('/api/team', settings({ ai_coach_model: 'deepseek/deepseek-v4-pro-0813' }));
    const r2 = (await owner.get<{ recipes: RecipeRow[] }>('/api/recipes')).body.recipes.find((r) => r.id !== r1.id)!;
    replies.push(
      reply(
        JSON.stringify({
          verdict: 'Sweet and clean.',
          tips: [
            { title: 'Finer', detail: 'Two clicks finer.' },
            { title: 'Cooler', detail: 'Try 88 °C.' },
          ],
          checks: [],
          next_test: null,
        }),
      ),
    );
    const tips = await owner.post<RecipeTipsResponse>(`/api/recipes/${r1.id}/tips`, {});
    expect(tips.status).toBe(200);
    expect(tips.body.tips).toMatchObject({ verdict: 'Sweet and clean.', checks: [], next_test: null });
    expect(calls[0]!.body).toMatchObject({ model: 'deepseek/deepseek-v4-pro-0813', max_tokens: 3000, reasoning: { effort: 'low', exclude: true } });

    replies.push(reply(JSON.stringify({ summary: 'The cooler one is softer.', changes: [], verdict: 'Too close to call.', next: 'Duel them.' })));
    const compare = await owner.post<CompareResponse>('/api/coach/compare', { a: r1.id, b: r2.id });
    expect(compare.body.read?.verdict).toBe('Too close to call.');
    expect(calls[1]!.body).toMatchObject({ model: 'deepseek/deepseek-v4-pro-0813', max_tokens: 4000, reasoning: { effort: 'low' } });
    const kinds = (await spendRows()).results.map((r) => [r.kind, r.model, r.cost_usd]);
    expect(kinds).toEqual([
      ['recipeTips', 'deepseek/deepseek-v4-pro-0813', 0.0049],
      ['compare', 'deepseek/deepseek-v4-pro-0813', 0.0049],
    ]);
  });
});
