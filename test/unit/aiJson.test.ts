import { describe, expect, it } from 'vitest';
import {
  duelReadOutput,
  experimentsOutput,
  quickLogOutput,
  readinessOutput,
  todayOutput,
} from '../../shared/schemas';
import { MAX_TOKENS, MODELS, PRICES, costUsd } from '../../worker/src/ai/config';
import { extractJson, parseAiJson, usageFromEvents } from '../../worker/src/ai/json';

const experiment = (over: Record<string, unknown> = {}) => ({
  title: 'Cooler water',
  parent: 'AK-R3',
  changes: { temp_c: 88 },
  why: 'Sweeter as it cools.',
  listenFor: 'Sweetness at 50 °C.',
  ...over,
});
const plan = (experiments: unknown[]) => JSON.stringify({ read: 'R3 wins most duels, but the data on Kenya is thin.', experiments });

describe('AI JSON: experiments (plan and adapt)', () => {
  it('accepts a valid reply, even wrapped in a code fence or a sentence', () => {
    const text = 'Here you go:\n```json\n' + plan([experiment(), experiment(), experiment()]) + '\n```';
    const result = parseAiJson(experimentsOutput, text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.experiments[0]?.changes).toEqual({ temp_c: 88 });
  });

  it('drops unknown keys: in changes, in an experiment, and at the top', () => {
    const text = JSON.stringify({
      read: 'Thin data.',
      mood: 'confident',
      experiments: [
        experiment({ changes: { temp_c: 88, secret_sauce: 'yes', grind_setting: 20 }, confidence: 0.9 }),
        experiment(),
        experiment(),
      ],
    });
    const result = parseAiJson(experimentsOutput, text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).not.toHaveProperty('mood');
    expect(result.data.experiments[0]).not.toHaveProperty('confidence');
    // Unknown change keys go; a numeric grind is read as text, a numeric-string temperature as a number.
    expect(result.data.experiments[0]?.changes).toEqual({ temp_c: 88, grind_setting: '20' });
    expect(parseAiJson(experimentsOutput, plan([experiment({ changes: { temp_c: '87.5' } }), experiment(), experiment()])).ok).toBe(true);
  });

  it('rejects invalid replies with a reason the retry can use', () => {
    const cases: [string, string][] = [
      ['Sorry, I cannot help with that.', 'not valid JSON'],
      ['{"read": "x", "experiments": [', 'not valid JSON'],
      [plan([experiment(), experiment()]), 'experiments'],
      [plan([experiment({ changes: { temp_c: 120 } }), experiment(), experiment()]), 'temp_c'],
      [plan([experiment({ changes: { method: 'French press' } }), experiment(), experiment()]), 'method'],
      [plan([experiment({ why: '' }), experiment(), experiment()]), 'why'],
    ];
    for (const [text, where] of cases) {
      const result = parseAiJson(experimentsOutput, text);
      expect(result.ok, text).toBe(false);
      if (!result.ok) expect(result.error).toContain(where);
    }
  });
});

describe('AI JSON: readiness, today and duel reads', () => {
  it('validates the readiness verdict and exactly three fixes', () => {
    const good = { verdict: 'close', biggestRisk: 'R7 is unproven on washed Ethiopians.', fixes: ['a', 'b', 'c'], evidence: 'R7 4-1.' };
    expect(parseAiJson(readinessOutput, JSON.stringify(good)).ok).toBe(true);
    expect(parseAiJson(readinessOutput, JSON.stringify({ ...good, verdict: 'probably' })).ok).toBe(false);
    expect(parseAiJson(readinessOutput, JSON.stringify({ ...good, fixes: ['a', 'b'] })).ok).toBe(false);
  });

  it('allows at most three duels today, and an empty list', () => {
    const duel = { a: 'AK-R3', b: 'AK-R7', why: 'Close Elo.' };
    expect(parseAiJson(todayOutput, JSON.stringify({ summary: 'Settle R3 vs R7.', duels: [duel] })).ok).toBe(true);
    expect(parseAiJson(todayOutput, JSON.stringify({ summary: 'Log brews first.', duels: [] })).ok).toBe(true);
    expect(parseAiJson(todayOutput, JSON.stringify({ summary: 'x', duels: [duel, duel, duel, duel] })).ok).toBe(false);
  });

  it('takes a duel read with or without a next test', () => {
    expect(parseAiJson(duelReadOutput, JSON.stringify({ read: 'R3 won 2-1.', next_test: experiment() })).ok).toBe(true);
    expect(parseAiJson(duelReadOutput, JSON.stringify({ read: 'Too close to call.', next_test: null })).ok).toBe(true);
  });
});

describe('AI JSON: quick log', () => {
  it('turns anything unreadable into null instead of failing (never invent a value)', () => {
    const reply = {
      grind_used: 22,
      total_time_s: '165',
      tds_pct: 1.32,
      beverage_g: 245,
      sweetness: 7.3,
      acidity: 'high',
      body: null,
      clarity: 8,
      finish: 11,
      overall: '7.5',
      notes: 'sweet but thin when cool',
      recipeMatch: { id: 'r-3', confidence: 0.9 },
      beanMatch: 'Guji',
      mood: 'happy',
    };
    const result = parseAiJson(quickLogOutput, JSON.stringify(reply));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      grind_used: '22',
      total_time_s: 165,
      tds_pct: 1.32,
      beverage_g: 245,
      sweetness: null,
      acidity: null,
      body: null,
      clarity: 8,
      finish: null,
      overall: 7.5,
      notes: 'sweet but thin when cool',
      recipeMatch: { id: 'r-3', confidence: 0.9 },
      beanMatch: { id: null, confidence: 0 },
    });
  });

  it('finds the JSON object in a reply', () => {
    expect(extractJson('text {"a": {"b": 1}} more')).toEqual({ a: { b: 1 } });
    expect(() => extractJson('no json here')).toThrow();
  });
});

describe('streamed answers', () => {
  it('reads the token counts from the event stream', () => {
    const events = [
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":900,"output_tokens":1}}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":42}}',
      '',
    ].join('\n');
    expect(usageFromEvents(events)).toMatchObject({ input_tokens: 900, output_tokens: 42 });
  });
});

describe('AI prices', () => {
  it('has a price for every model the app calls, so no call is ever logged as free', () => {
    for (const [kind, model] of Object.entries(MODELS)) {
      expect(PRICES[model], kind).toBeDefined();
      expect(costUsd(model, 1000, MAX_TOKENS[kind as keyof typeof MODELS]), kind).toBeGreaterThan(0);
    }
  });
});
