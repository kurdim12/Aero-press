import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportPage, RecipeRow, TeamSettings } from '../../shared/types';
import { aiTransport } from '../src/ai/client';
import { TEAM_PIN, addBarista, freshDb, recipeBody, setupTeam, signIn } from './helpers';

// A fake Anthropic API: each call takes the next queued reply and is recorded.
type Reply = (body: Record<string, unknown>) => Response;
let replies: Reply[] = [];
let requests: Record<string, unknown>[] = [];

function eventStream(text: string, model: string): Response {
  const events = [
    ['message_start', { type: 'message_start', message: { id: 'msg_k', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 4000, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 300 } }],
    ['message_stop', { type: 'message_stop' }],
  ] as const;
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const json = (value: unknown): Reply => (body) => eventStream(JSON.stringify(value), String(body.model));
const text = (value: string): Reply => (body) => eventStream(value, String(body.model));

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

const RULES = 'Our kettle holds 85–100 °C. Grinder: Comandante C40, in clicks.';

const settingsBody = { name: 'Kurdi Coffee Lab', ai_monthly_budget_usd: 20 };

async function teamWithRules() {
  const { owner } = await setupTeam();
  const bean = (await owner.post<{ id: string }>('/api/beans', { name: 'Ethiopia Guji', process: 'Washed' })).body;
  const r1 = (await owner.post<RecipeRow>('/api/recipes', recipeBody({ name: 'Base', bean_id: bean.id }))).body;
  await owner.post<RecipeRow>('/api/recipes', recipeBody({ name: 'Cooler', temp_c: 86, bean_id: bean.id }));
  expect((await owner.put<TeamSettings>('/api/team', { ...settingsBody, coach_rules: RULES })).status).toBe(200);
  return { owner, bean, r1 };
}

const systemOf = (i: number) => String(requests[i]?.system);

async function ask(owner: Awaited<ReturnType<typeof setupTeam>>['owner'], question: string) {
  replies.push(text('Brew it.'));
  const res = await exports.default.fetch(
    new Request(`${owner.origin}/api/coach/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ question }),
    }),
  );
  expect(res.status).toBe(200);
  await res.text();
  // The stream's cost is settled after the answer (in waitUntil): let it finish.
  await vi.waitFor(async () => {
    const open = await env.DB.prepare('SELECT COUNT(*) AS n FROM ai_calls WHERE output_tokens <> 300').first<{ n: number }>();
    expect(open?.n).toBe(0);
  });
}

describe('what the coach is taught', () => {
  it('sends the reference for the job and the owner’s house rules with every coach call', async () => {
    const { owner, r1 } = await teamWithRules();
    const idea = { title: 'Finer', parent: r1.display_code, changes: { temp_c: 90 }, why: 'Dense washed coffee.', listenFor: 'Sweetness.' };
    replies.push(json({ read: 'Thin data.', experiments: [idea, idea, idea] }));
    expect((await owner.post('/api/coach/plan', {})).status).toBe(200);
    const plan = systemOf(0);
    expect(plan).toContain('World AeroPress Championship');
    expect(plan).toContain('Give every number a reason');
    expect(plan).toContain('## Dialling in and testing');
    expect(plan).toContain('## Water temperature');
    expect(plan).toContain('## What the podium recipes show');
    expect(plan).not.toContain('## Sourcing and green coffee');
    // The house rules come last, so they win.
    expect(plan.indexOf('<house_rules>')).toBeGreaterThan(plan.indexOf('</reference>'));
    expect(plan).toContain(RULES);

    // Tips on a coffee get the coffee sections.
    const bean = (await owner.post<{ id: string }>('/api/beans', { name: 'Kenya Nyeri' })).body;
    replies.push(json({ summary: 'Bright.', tips: ['Grind finer.', 'Go hotter.'], start: null }));
    expect((await owner.post(`/api/beans/${bean.id}/tips`, {})).status).toBe(200);
    expect(systemOf(1)).toContain('## Varieties, origins and density');
    expect(systemOf(1)).toContain('## Processing');
    expect(systemOf(1)).toContain(RULES);

    // Quick log only reads a note: no reference, no house rules.
    replies.push(
      json({
        grind_used: null, total_time_s: null, tds_pct: null, beverage_g: null,
        sweetness: null, acidity: null, body: null, clarity: null, finish: null, overall: null,
        notes: null, recipeMatch: { id: null, confidence: 0 }, beanMatch: { id: null, confidence: 0 },
      }),
    );
    expect((await owner.post('/api/coach/quick-log', { text: 'R1, sweet' })).status).toBe(200);
    expect(systemOf(2)).not.toContain('<reference>');
    expect(systemOf(2)).not.toContain(RULES);
  });

  it('picks the reference sections from the question', async () => {
    const { owner } = await teamWithRules();
    await ask(owner, 'Which water minerals should we use: Third Wave Water or Aquacode?');
    expect(systemOf(0)).toContain('## Water\n');
    expect(systemOf(0)).not.toContain('## Grind\n');
    expect(systemOf(0)).toContain(RULES);

    await ask(owner, 'What should I try next?');
    expect(systemOf(1)).toContain('## Grind\n');
    expect(systemOf(1)).toContain('## Water temperature\n');

    await ask(owner, 'كم يوم نترك البن يرتاح بعد التحميص؟');
    expect(systemOf(2)).toContain('## Roast, rest and storage\n');
  });
});

describe('house rules', () => {
  it('are the owner’s to set; everyone reads them; the backup keeps them', async () => {
    const { owner } = await setupTeam();
    const lina = (await signIn(await addBarista(owner, 'Lina Haddad'), TEAM_PIN)).client;
    expect((await owner.get<TeamSettings>('/api/team')).body.coach_rules).toBeNull();

    expect((await lina.put('/api/team', { ...settingsBody, coach_rules: RULES })).status).toBe(403);
    expect((await owner.put<TeamSettings>('/api/team', { ...settingsBody, coach_rules: `  ${RULES}  ` })).body.coach_rules).toBe(RULES);
    expect((await lina.get<TeamSettings>('/api/team')).body.coach_rules).toBe(RULES);

    // A phone that doesn't know the field leaves the rules alone; a blank box clears them.
    expect((await owner.put<TeamSettings>('/api/team', settingsBody)).body.coach_rules).toBe(RULES);
    const team = (await owner.get<ExportPage>('/api/export?part=team')).body.rows[0];
    expect(team).toMatchObject({ coach_rules: RULES });
    expect((await owner.put<TeamSettings>('/api/team', { ...settingsBody, coach_rules: ' ' })).body.coach_rules).toBeNull();

    const long = await owner.put('/api/team', { ...settingsBody, coach_rules: 'x'.repeat(1501) });
    expect(long.status).toBe(400);
    expect(long.body.error.field).toBe('coach_rules');
  });
});
