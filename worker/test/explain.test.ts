import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHAMPION_RECIPES } from '../../shared/champions';
import type { ChampionBreakdownResponse, CompareResponse, ExportPage, RecipeRow } from '../../shared/types';
import { aiTransport } from '../src/ai/client';
import { TEAM_PIN, addBarista, freshDb, recipeBody, setupTeam, signIn } from './helpers';

// A fake Anthropic API: each call takes the next queued reply and is recorded.
type Reply = (body: Record<string, unknown>) => Response;
let replies: Reply[] = [];
let requests: Record<string, unknown>[] = [];

function eventStream(text: string, model: string): Response {
  const events = [
    ['message_start', { type: 'message_start', message: { id: 'msg_e', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3500, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 900 } }],
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

const explanation = (verdict = 'Probably, but duel them to be sure.') => ({
  summary: 'The new one is gentler: cooler water for a sweeter, softer cup.',
  changes: [
    {
      setting: 'Water temperature',
      from: 90,
      to: '86 °C',
      why: 'To make the cup sweeter and less sharp.',
      how: 'Cooler water pulls flavour out more slowly, so fewer bitter parts come out.',
      cup: 'Sweeter and rounder, a little less bright.',
    },
  ],
  verdict,
  next: 'Run a blind duel between the two on the same coffee.',
});

const breakdown = {
  summary: 'A short, gentle brew that keeps the coffee sweet and clean.',
  choices: [
    { setting: 'Water temperature', value: '84 °C', why: 'Likely to keep a delicate coffee sweet.', how: 'Cooler water extracts more gently.' },
    { setting: 'Bypass', value: '70 g at 50 °C', why: 'To serve a lighter cup.', how: 'Adding water after brewing lowers strength without changing flavour balance.' },
  ],
  lessons: ['Try a cooler brew on light roasts.', 'Test a bypass to lighten a heavy cup.'],
};

async function team() {
  const { owner, me } = await setupTeam();
  const bean = (await owner.post<{ id: string }>('/api/beans', { name: 'Kenya Nyeri' })).body;
  const r1 = (await owner.post<RecipeRow>('/api/recipes', recipeBody({ name: 'Base', bean_id: bean.id }))).body;
  const r2 = (
    await owner.post<RecipeRow>(
      '/api/recipes',
      recipeBody({ name: 'Cooler', parent_id: r1.id, bean_id: bean.id, temp_c: 86, notes: 'Why: sweeter in the cup, less sharp.' }),
    )
  ).body;
  return { owner, me, bean, r1, r2 };
}

const sent = (i: number) => JSON.stringify(requests[i]?.messages);
const aiCalls = () => env.DB.prepare('SELECT kind FROM ai_calls ORDER BY created_at').all<{ kind: string }>();
const readRows = () => env.DB.prepare('SELECT id, kind, claim FROM ai_reads').all<{ id: string; kind: string; claim: string | null }>();
const published = (id: string) => {
  const entry = CHAMPION_RECIPES.find((e) => e.id === id);
  if (!entry?.recipe) throw new Error(`no published recipe for ${id}`);
  return { ...entry, recipe: entry.recipe };
};

describe('explained comparisons', () => {
  it('explains a newer version against the one it came from, old first, and keeps it for the team', async () => {
    const { owner, r1, r2 } = await team();
    const query = `/api/coach/compare?a=recipe:${r2.id}&b=recipe:${r1.id}`;
    expect((await owner.get<CompareResponse>(query)).body).toEqual({ read: null, at: null, pending: false, stale: false, configured: true });

    replies.push(json(explanation()));
    // Picked new first; the coach still explains old → new.
    const res = await owner.post<CompareResponse>('/api/coach/compare', { a: { kind: 'recipe', id: r2.id }, b: { kind: 'recipe', id: r1.id } });
    expect(res.status).toBe(200);
    expect(res.body.read).toMatchObject({ first: `recipe:${r1.id}`, verdict: 'Probably, but duel them to be sure.' });
    expect(res.body.read?.changes[0]).toMatchObject({ setting: 'Water temperature', from: '90', to: '86 °C' });

    const prompt = sent(0);
    expect(prompt).toContain('The second recipe is a newer version of the first');
    expect(prompt).toContain(`${r2.display_code} was cloned from ${r1.display_code}`);
    expect(prompt).toContain('Why: sweeter in the cup');
    expect(prompt).toContain('\\"setting\\":\\"temp_c\\",\\"first\\":90,\\"second\\":86');
    expect(prompt).not.toContain('\\"setting\\":\\"dose_g\\"');
    expect(prompt).toContain('\\"head_to_head\\":{\\"duels\\":0');
    expect(prompt).toContain('Write for a barista, not a scientist');
    expect(requests[0]?.output_config).toEqual({ effort: 'low' });
    expect((await aiCalls()).results).toEqual([{ kind: 'compare' }]);

    // Kept for everyone, whichever order the recipes are picked in; asking again is free.
    const back = await owner.get<CompareResponse>(`/api/coach/compare?a=recipe:${r1.id}&b=${r2.id}`);
    expect(back.body.read).toEqual(res.body.read);
    expect((await owner.post<CompareResponse>('/api/coach/compare', { a: r1.id, b: r2.id })).body.read).toEqual(res.body.read);
    expect(requests).toHaveLength(1);

    // Editing either recipe marks it stale; "Explain again" writes a new one.
    await env.DB.prepare('UPDATE ai_reads SET result_at = result_at - 1000').run();
    await owner.put(`/api/recipes/${r2.id}`, recipeBody({ name: 'Cooler', temp_c: 85 }));
    expect((await owner.get<CompareResponse>(query)).body.stale).toBe(true);
    const shown = (await owner.get<CompareResponse>(query)).body.at;
    replies.push(json(explanation('Yes: it won both duels.')));
    const again = await owner.post<CompareResponse>('/api/coach/compare', { a: r2.id, b: r1.id, refresh: true, seen: shown });
    expect(again.body).toMatchObject({ stale: false, read: { verdict: 'Yes: it won both duels.' } });
    expect((await aiCalls()).results).toHaveLength(2);
    // Another phone still showing the old one taps "Explain again": it gets the new one, free.
    const late = await owner.post<CompareResponse>('/api/coach/compare', { a: r1.id, b: r2.id, refresh: true, seen: shown });
    expect(late.body.read?.verdict).toBe('Yes: it won both duels.');
    expect((await aiCalls()).results).toHaveLength(2);
  });

  it('puts a champion’s recipe first and explains it against ours', async () => {
    const { owner, r1 } = await team();
    const champ = published('wac-2019-1');
    replies.push(json(explanation('Borrow the bypass; keep your grind.')));
    const res = await owner.post<CompareResponse>('/api/coach/compare', { a: r1.id, b: { kind: 'champion', id: champ.id } });
    expect(res.status).toBe(200);
    expect(res.body.read?.first).toBe(`champion:${champ.id}`);
    const prompt = sent(0);
    expect(prompt).toContain('The first is a World AeroPress Championship podium recipe');
    expect(prompt).toContain(champ.name);
    expect(prompt).toContain('method_as_published');
    expect(prompt).toContain('Champions rarely publish their reasons');
    expect(prompt).not.toContain('head_to_head');
    expect(prompt).not.toContain('\\"setting\\":\\"bean\\"');
    // The same pair from the champion's side is the same kept explanation.
    const kept = await owner.get<CompareResponse>(`/api/coach/compare?a=champion:${champ.id}&b=recipe:${r1.id}`);
    expect(kept.body.read).toEqual(res.body.read);
  });

  it('compares two champions, the earlier one first, with no team recipe involved', async () => {
    const { owner } = await setupTeam();
    replies.push(json(explanation('Both keep the brew short and gentle.')));
    const res = await owner.post<CompareResponse>('/api/coach/compare', {
      a: { kind: 'champion', id: 'wac-2024-1' },
      b: { kind: 'champion', id: 'wac-2017-1' },
    });
    expect(res.body.read?.first).toBe('champion:wac-2017-1');
    expect(sent(0)).toContain('Both are World AeroPress Championship podium recipes; the first is the earlier one');
    expect(sent(0)).toContain('WAC 2017 1st is the earlier one');
  });

  it('refuses the same recipe twice, unknown recipes and other teams’ recipes, and needs a key', async () => {
    const { owner, r1, r2 } = await team();
    expect((await owner.post('/api/coach/compare', { a: r1.id, b: { kind: 'recipe', id: r1.id } })).body.error.field).toBe('b');
    expect((await owner.get(`/api/coach/compare?a=recipe:${r1.id}&b=${r1.id}`)).status).toBe(400);
    expect((await owner.get(`/api/coach/compare?a=recipe:${r1.id}`)).status).toBe(400);
    expect((await owner.post('/api/coach/compare', { a: r1.id, b: 'missing' })).status).toBe(404);
    expect((await owner.post('/api/coach/compare', { a: r1.id, b: { kind: 'champion', id: 'wac-1999-1' } })).status).toBe(404);
    const unpublished = CHAMPION_RECIPES.find((e) => !e.recipe);
    if (unpublished) expect((await owner.get(`/api/coach/compare?a=recipe:${r1.id}&b=champion:${unpublished.id}`)).status).toBe(404);

    // Another team's recipe is out of reach.
    await env.DB.prepare(`INSERT INTO teams (id, name, pin_hash, pin_salt, created_at) VALUES ('t2', 'Other', 'x', 'y', 0)`).run();
    await env.DB.prepare(`UPDATE recipes SET team_id = 't2' WHERE id = ?`).bind(r2.id).run();
    expect((await owner.get(`/api/coach/compare?a=${r1.id}&b=${r2.id}`)).status).toBe(404);
    expect((await owner.post('/api/coach/compare', { a: r1.id, b: r2.id })).status).toBe(404);

    // No key: nothing is claimed or called.
    aiTransport.apiKey = undefined;
    const res = await owner.post('/api/coach/compare', { a: r1.id, b: { kind: 'champion', id: 'wac-2019-1' } });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ai_not_configured');
    expect((await readRows()).results).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it('never pays twice for one explanation, and frees the claim when a call fails', async () => {
    const { owner, me, r1, r2 } = await team();
    const key = `compare:${[`recipe:${r1.id}`, `recipe:${r2.id}`].sort().join('|')}`;
    await env.DB.prepare(`INSERT INTO ai_reads (team_id, id, kind, claim, created_at) VALUES (?, ?, 'compare', ?, ?)`)
      .bind(me.team.id, key, `pending:${Date.now()}`, Date.now())
      .run();
    const waiting = await owner.post<CompareResponse>('/api/coach/compare', { a: r1.id, b: r2.id });
    expect(waiting.status).toBe(202);
    expect(waiting.body).toMatchObject({ read: null, pending: true });
    expect(requests).toHaveLength(0);

    await env.DB.prepare('DELETE FROM ai_reads').run();
    replies.push(apiError(500), apiError(500));
    const failed = await owner.post('/api/coach/compare', { a: r1.id, b: r2.id });
    expect(failed.status).toBe(503);
    expect(failed.body.error.code).toBe('ai_busy');
    expect((await readRows()).results).toEqual([{ id: key, kind: 'compare', claim: null }]);

    // Two phones at once: one call.
    replies.push(json(explanation()));
    const both = await Promise.all([
      owner.post<CompareResponse>('/api/coach/compare', { a: r1.id, b: r2.id }),
      owner.post<CompareResponse>('/api/coach/compare', { a: r2.id, b: r1.id }),
    ]);
    expect(requests).toHaveLength(3);
    for (const r of both) expect(r.body.read !== null || r.body.pending).toBe(true);
  });
});

describe('champion breakdowns', () => {
  it('explains a champion recipe once for the whole team', async () => {
    const { owner, r1 } = await team();
    const champ = published('wac-2025-1');
    const path = `/api/coach/champions/${champ.id}`;
    expect((await owner.get<ChampionBreakdownResponse>(path)).body).toEqual({ read: null, at: null, pending: false, stale: false, configured: true });

    replies.push(json(breakdown));
    const res = await owner.post<ChampionBreakdownResponse>(path, {});
    expect(res.status).toBe(200);
    expect(res.body.read?.choices).toHaveLength(2);
    expect(res.body.read?.lessons).toHaveLength(2);
    const prompt = sent(0);
    expect(prompt).toContain('Break down the World AeroPress Championship recipe below');
    expect(prompt).toContain(champ.name);
    expect(prompt).toContain('Flow Control');
    expect(prompt).toContain('best_recipes');
    expect(prompt).toContain(r1.display_code);
    expect((await aiCalls()).results).toEqual([{ kind: 'championRead' }]);

    // Everyone sees it; asking again is free.
    const linaId = await addBarista(owner, 'Lina Haddad');
    const lina = (await signIn(linaId, TEAM_PIN)).client;
    expect((await lina.get<ChampionBreakdownResponse>(path)).body.read).toEqual(res.body.read);
    expect((await lina.post<ChampionBreakdownResponse>(path, {})).body.read).toEqual(res.body.read);
    expect(requests).toHaveLength(1);

    expect((await owner.get('/api/coach/champions/wac-1999-1')).status).toBe(404);
    expect((await owner.post('/api/coach/champions/wac-1999-1', {})).status).toBe(404);
  });

  it('backs up the kept explanations', async () => {
    const { owner } = await team();
    replies.push(json(breakdown));
    await owner.post('/api/coach/champions/wac-2025-1', {});
    const page = (await owner.get<ExportPage>('/api/export?part=ai_reads')).body;
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({ id: 'champion:wac-2025-1', kind: 'champion' });
    expect(page.rows[0]).not.toHaveProperty('claim');
  });
});
