import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BeanTipsResponse, CompareRead, ExportPage, RecipeRow, RecipeTipsResponse, TeamSettings } from '../../shared/types';
import { aiTransport } from '../src/ai/client';
import { freshDb, recipeBody, setupTeam } from './helpers';

// A fake Anthropic API: each call takes the next queued reply and is recorded.
type Reply = (body: Record<string, unknown>) => Response | Promise<Response>;
let replies: Reply[] = [];
let requests: Record<string, unknown>[] = [];

function eventStream(text: string, model: string): Response {
  const usage = { input_tokens: 3000, output_tokens: 600 };
  const events = [
    ['message_start', { type: 'message_start', message: { id: 'msg_t', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: usage.input_tokens, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: usage.output_tokens } }],
    ['message_stop', { type: 'message_stop' }],
  ] as const;
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const json = (value: unknown): Reply => (body) => eventStream(JSON.stringify(value), String(body.model));

const apiError = (status: number): Reply => () =>
  new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'nope' } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

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
  aiTransport.openRouterKey = undefined;
  aiTransport.fetch = undefined;
});

const experiment = (parent: string | null, changes: Record<string, unknown>) => ({
  title: 'Cooler and finer',
  parent,
  changes,
  why: 'Dense coffee, gentler heat.',
  listenFor: 'Sweetness as it cools.',
});

const recipeTips = (parent: string) => ({
  verdict: 'Balanced and sweet, a little thin next to the team’s best.',
  tips: [
    { title: 'Finer grind', detail: 'Two clicks finer for body.' },
    { title: 'Shorter press', detail: 'Press in 25 s, not 30.' },
  ],
  checks: ['Planned total 2:40 leaves room; no issue there.'],
  next_test: experiment(parent, { temp_c: 88, grind_setting: '20 clicks' }),
});

async function team() {
  const { owner, me } = await setupTeam();
  const bean = (await owner.post<{ id: string; name: string }>('/api/beans', { name: 'Kenya Nyeri', process: 'Washed', roast_date: '2026-09-20' })).body;
  const r1 = (await owner.post<RecipeRow>('/api/recipes', recipeBody({ name: 'Base', bean_id: bean.id }))).body;
  const r2 = (await owner.post<RecipeRow>('/api/recipes', recipeBody({ name: 'Cooler', temp_c: 86, grind_setting: '18 clicks', bean_id: bean.id }))).body;
  return { owner, me, bean, r1, r2 };
}

const tipsRow = (id: string) => env.DB.prepare('SELECT tips_json, tips_at, claim FROM ai_tips WHERE id = ?').bind(id).first<{ tips_json: string | null; tips_at: number | null; claim: string | null }>();
const aiCalls = () => env.DB.prepare('SELECT kind FROM ai_calls ORDER BY created_at').all<{ kind: string }>();

describe('coach tips on a recipe', () => {
  it('writes a review once, keeps it for everyone, and refreshes it on request', async () => {
    const { owner, r1 } = await team();
    const path = `/api/recipes/${r1.id}/tips`;

    // New recipe, key set, automatic tips on: the phone should ask on its own.
    expect((await owner.get<RecipeTipsResponse>(path)).body).toEqual({ tips: null, at: null, pending: false, stale: false, configured: true, auto: true });

    replies.push(json(recipeTips('XX-R9')));
    const res = await owner.post<RecipeTipsResponse>(path, { refresh: false });
    expect(res.status).toBe(200);
    expect(res.body.tips?.verdict).toContain('Balanced');
    expect(res.body.tips?.tips).toHaveLength(2);
    // The next test always clones this recipe, whatever parent the coach wrote.
    expect(res.body.tips?.next_test).toMatchObject({ parent: r1.display_code, parent_id: r1.id, changes: { temp_c: 88, grind_setting: '20 clicks' } });

    // The request carried this recipe in full, and went to the coach model at low effort.
    const request = requests[0]!;
    expect(request.model).toBe('claude-sonnet-5');
    expect(request.output_config).toEqual({ effort: 'low' });
    const sent = JSON.stringify(request.messages);
    expect(sent).toContain(`Review recipe ${r1.display_code}`);
    expect(sent).toContain('Kenya Nyeri');
    expect((await aiCalls()).results).toEqual([{ kind: 'recipeTips' }]);

    // Saved for everyone; asking again without refresh costs nothing.
    const again = await owner.post<RecipeTipsResponse>(path, { refresh: false });
    expect(again.body.tips).toEqual(res.body.tips);
    const read = (await owner.get<RecipeTipsResponse>(path)).body;
    expect(read).toMatchObject({ pending: false, stale: false, auto: false });
    expect(read.at).toBeTypeOf('number');
    expect(requests).toHaveLength(1);

    // Editing the recipe marks the review stale; "Update tips" writes a new one.
    await env.DB.prepare('UPDATE ai_tips SET tips_at = tips_at - 1000 WHERE id = ?').bind(`recipe:${r1.id}`).run();
    await owner.put(`/api/recipes/${r1.id}`, recipeBody({ name: 'Base', dose_g: 17 }));
    expect((await owner.get<RecipeTipsResponse>(path)).body.stale).toBe(true);
    replies.push(json({ ...recipeTips(r1.display_code), verdict: 'Better with 17 g.' }));
    const refreshed = await owner.post<RecipeTipsResponse>(path, { refresh: true });
    expect(refreshed.body).toMatchObject({ stale: false, tips: { verdict: 'Better with 17 g.' } });
    expect((await aiCalls()).results).toHaveLength(2);
  });

  it('never pays twice: a phone that finds tips being written waits for them', async () => {
    const { owner, r1 } = await team();
    const path = `/api/recipes/${r1.id}/tips`;
    const key = `recipe:${r1.id}`;
    const claim = (ms: number) =>
      env.DB.prepare(`INSERT INTO ai_tips (id, team_id, subject, subject_id, claim, created_at) VALUES (?, (SELECT team_id FROM recipes WHERE id = ?), 'recipe', ?, ?, ?)`)
        .bind(key, r1.id, r1.id, `pending:${ms}`, ms)
        .run();

    await claim(Date.now());
    const waiting = await owner.post<RecipeTipsResponse>(path, { refresh: true });
    expect(waiting.status).toBe(202);
    expect(waiting.body).toMatchObject({ tips: null, pending: true, auto: false });
    expect(requests).toHaveLength(0);

    // A claim left by a writer that died is taken over.
    await env.DB.prepare('DELETE FROM ai_tips').run();
    await claim(Date.now() - 7 * 60_000);
    replies.push(json(recipeTips(r1.display_code)));
    expect((await owner.post<RecipeTipsResponse>(path, {})).body.tips).not.toBeNull();
    expect(requests).toHaveLength(1);

    // Two phones at once: one call; each gets the tips or is told to wait for them.
    await env.DB.prepare('DELETE FROM ai_tips').run();
    replies.push(json(recipeTips(r1.display_code)));
    const both = await Promise.all([owner.post<RecipeTipsResponse>(path, {}), owner.post<RecipeTipsResponse>(path, {})]);
    expect(requests).toHaveLength(2);
    for (const r of both) expect(r.body.tips !== null || r.body.pending).toBe(true);
    expect((await tipsRow(key))?.claim).toBeNull();
  });

  it('frees the claim when the call fails, so the next tap can try again', async () => {
    const { owner, r1 } = await team();
    const path = `/api/recipes/${r1.id}/tips`;
    replies.push(apiError(500), apiError(500));
    const failed = await owner.post(path, {});
    expect(failed.status).toBe(503);
    expect(failed.body.error.code).toBe('ai_busy');
    expect(await tipsRow(`recipe:${r1.id}`)).toMatchObject({ tips_json: null, claim: null });
    expect((await owner.get<RecipeTipsResponse>(path)).body).toMatchObject({ pending: false, tips: null });

    replies.push(json(recipeTips(r1.display_code)));
    expect((await owner.post<RecipeTipsResponse>(path, {})).body.tips).not.toBeNull();
  });

  it('asks on its own only for new recipes, with a key, while the owner allows it', async () => {
    const { owner, r1 } = await team();
    const path = `/api/recipes/${r1.id}/tips`;
    // A recipe older than a day: tips on a tap only.
    await env.DB.prepare('UPDATE recipes SET created_at = created_at - 2 * 86400000 WHERE id = ?').bind(r1.id).run();
    expect((await owner.get<RecipeTipsResponse>(path)).body.auto).toBe(false);
    await env.DB.prepare('UPDATE recipes SET created_at = ? WHERE id = ?').bind(Date.now(), r1.id).run();
    expect((await owner.get<RecipeTipsResponse>(path)).body.auto).toBe(true);

    // The owner turns automatic tips off.
    const settings = (await owner.get<TeamSettings>('/api/team')).body;
    expect(settings.ai_auto_tips).toBe(true);
    const saved = await owner.put<TeamSettings>('/api/team', { ...settings, ai_auto_tips: false });
    expect(saved.body.ai_auto_tips).toBe(false);
    expect((await owner.get<RecipeTipsResponse>(path)).body.auto).toBe(false);
    // Leaving the field out keeps it.
    const { ai_auto_tips: _auto, ...rest } = settings;
    expect((await owner.put<TeamSettings>('/api/team', rest)).body.ai_auto_tips).toBe(false);

    // No key: nothing is claimed or called, and the phone is told why.
    aiTransport.apiKey = undefined;
    expect((await owner.get<RecipeTipsResponse>(path)).body).toMatchObject({ configured: false, auto: false });
    const res = await owner.post(path, {});
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ai_not_configured');
    expect(await tipsRow(`recipe:${r1.id}`)).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it('stops at the budget and keeps other teams out', async () => {
    const { owner, me, r1 } = await team();
    await env.DB.prepare('UPDATE teams SET ai_monthly_budget_usd = 0 WHERE id = ?').bind(me.team.id).run();
    const res = await owner.post(`/api/recipes/${r1.id}/tips`, {});
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('ai_budget_exceeded');
    expect(requests).toHaveLength(0);

    // Another team can't read or write this recipe's tips.
    await env.DB.prepare(`INSERT INTO teams (id, name, pin_hash, pin_salt, created_at) VALUES ('t2', 'Other', 'x', 'y', 0)`).run();
    await env.DB.prepare(`UPDATE recipes SET team_id = 't2' WHERE id = ?`).bind(r1.id).run();
    expect((await owner.get(`/api/recipes/${r1.id}/tips`)).status).toBe(404);
    expect((await owner.post(`/api/recipes/${r1.id}/tips`, {})).status).toBe(404);
  });
});

describe('coach tips on a coffee', () => {
  it('writes what to expect, tips, and a starting recipe on this coffee', async () => {
    const { owner, bean, r2 } = await team();
    const path = `/api/beans/${bean.id}/tips`;
    expect((await owner.get<BeanTipsResponse>(path)).body.auto).toBe(true);
    replies.push(
      json({
        summary: 'A bright washed Kenyan: expect blackcurrant acidity; it extracts fast.',
        tips: ['Start at 88 °C.', 'Keep the steep under 2 minutes.', 'Use a bypass of 30 g if it tastes sharp.'],
        start: experiment(r2.display_code, { temp_c: 88, bean_id: 'somewhere else' }),
      }),
    );
    const res = await owner.post<BeanTipsResponse>(path, {});
    expect(res.status).toBe(200);
    expect(res.body.tips?.tips).toHaveLength(3);
    // The start recipe clones the team recipe the coach named, on this coffee.
    expect(res.body.tips?.start).toMatchObject({ parent_id: r2.id, changes: { temp_c: 88, bean_id: bean.id } });
    const sent = JSON.stringify(requests[0]?.messages);
    expect(sent).toContain('The team just added the coffee below');
    expect(sent).toContain('days_off_roast');
    expect(sent).toContain(r2.display_code);
    expect((await aiCalls()).results).toEqual([{ kind: 'beanTips' }]);

    // Editing the coffee marks the tips stale.
    await env.DB.prepare('UPDATE ai_tips SET tips_at = tips_at - 1000').run();
    await owner.put(`/api/beans/${bean.id}`, { name: 'Kenya Nyeri AA', process: 'Washed' });
    expect((await owner.get<BeanTipsResponse>(path)).body.stale).toBe(true);
    expect((await owner.get(`/api/beans/nope/tips`)).status).toBe(404);
  });
});

describe('compare and ask about', () => {
  it('explains what two recipes’ differences do, from the settings that differ', async () => {
    const { owner, r1, r2 } = await team();
    replies.push(
      json({
        read: 'The cooler one should be sweeter and softer.',
        effects: [{ change: 'Temperature 90 → 86 °C', effect: 'Less bitterness, softer acidity.' }],
        duel: 'Taste both at 50 °C for sweetness.',
      }),
    );
    const res = await owner.post<CompareRead>('/api/coach/compare', { a: r1.id, b: r2.id });
    expect(res.status).toBe(200);
    expect(res.body.effects).toHaveLength(1);
    const sent = JSON.stringify(requests[0]?.messages);
    expect(sent).toContain('\\"setting\\":\\"temp_c\\",\\"a\\":90,\\"b\\":86');
    expect(sent).toContain('grind_setting');
    expect(sent).not.toContain('\\"setting\\":\\"dose_g\\"');
    expect((await aiCalls()).results).toEqual([{ kind: 'compare' }]);

    expect((await owner.post('/api/coach/compare', { a: r1.id, b: r1.id })).body.error.field).toBe('b');
    expect((await owner.post('/api/coach/compare', { a: r1.id, b: 'missing' })).status).toBe(404);
  });

  it('adds the bean or recipe a question is about', async () => {
    const { owner, bean, r1 } = await team();
    const ask = async (about: unknown) => {
      const res = await exports.default.fetch(
        new Request(`${owner.origin}/api/coach/ask`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: owner.cookie },
          body: JSON.stringify({ question: 'How do we make it sweeter?', about }),
        }),
      );
      await res.text();
      return res.status;
    };
    replies.push((body) => eventStream('Cooler water.', String(body.model)));
    expect(await ask({ kind: 'recipe', id: r1.id })).toBe(200);
    expect(JSON.stringify(requests[0]?.messages)).toContain(`The question is about this recipe:\\n<recipe>`);

    replies.push((body) => eventStream('Grind finer.', String(body.model)));
    expect(await ask({ kind: 'bean', id: bean.id })).toBe(200);
    const sent = JSON.stringify(requests[1]?.messages);
    expect(sent).toContain('<coffee>');
    expect(sent).toContain('recipes_on_it');

    expect(await ask({ kind: 'recipe', id: 'missing' })).toBe(404);
    expect(await ask({ kind: 'duel', id: r1.id })).toBe(400);
    expect(requests).toHaveLength(2);
  });

  it('backs up the tips with the rest of the team’s data', async () => {
    const { owner, r1 } = await team();
    replies.push(json(recipeTips(r1.display_code)));
    await owner.post(`/api/recipes/${r1.id}/tips`, {});
    const page = (await owner.get<ExportPage>('/api/export?part=ai_tips')).body;
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({ id: `recipe:${r1.id}`, subject: 'recipe', subject_id: r1.id });
    expect(page.rows[0]).not.toHaveProperty('claim');
    expect((await owner.get<ExportPage>('/api/export?part=team')).body.rows[0]).toMatchObject({ ai_auto_tips: 1 });
  });
});
