import { describe, expect, it } from 'vitest';
import {
  beanTipsOutput,
  compareOutput,
  duelReadOutput,
  experimentsOutput,
  quickLogOutput,
  readinessOutput,
  recipeTipsOutput,
  todayOutput,
} from '../../shared/schemas';
import { OPENROUTER_DEFAULTS, OPENROUTER_MODELS } from '../../shared/aiModels';
import { chatStreamUsage, deltaText, isStreamError, parseDataLine } from '../../shared/aiStream';
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
    for (const model of OPENROUTER_MODELS) expect(costUsd(model.id, 1000, 1000), model.id).toBeGreaterThan(0);
    for (const model of Object.values(OPENROUTER_DEFAULTS)) expect(OPENROUTER_MODELS.some((m) => m.id === model)).toBe(true);
  });
});

describe('streamed answers from either provider', () => {
  const anthropic = (text: string) => `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}`;
  const chat = (content: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}`;

  it('reads text deltas in both formats and skips comments, [DONE] and junk', () => {
    expect(deltaText(parseDataLine(anthropic('Brew '))!)).toBe('Brew ');
    expect(deltaText(parseDataLine(chat('cooler.'))!)).toBe('cooler.');
    expect(parseDataLine(': OPENROUTER PROCESSING')).toBeNull();
    expect(parseDataLine('data: [DONE]')).toBeNull();
    expect(parseDataLine('data: {broken')).toBeNull();
    expect(deltaText(parseDataLine(`data: ${JSON.stringify({ type: 'message_start', message: {} })}`)!)).toBe('');
  });

  it('spots a stream that fails after it started', () => {
    expect(isStreamError(parseDataLine(`data: ${JSON.stringify({ type: 'error', error: { type: 'overloaded_error' } })}`)!)).toBe(true);
    expect(isStreamError(parseDataLine(`data: ${JSON.stringify({ error: { message: 'x' }, choices: [{ finish_reason: 'error' }] })}`)!)).toBe(true);
    expect(isStreamError(parseDataLine(chat('fine'))!)).toBe(false);
  });

  it('finds OpenRouter’s usage and cost in the last chunk', () => {
    const usage = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1200, completion_tokens: 40, cost: 0.00105 } })}`;
    const text = [': OPENROUTER PROCESSING', '', chat('say \"usage\" here'), '', usage, '', 'data: [DONE]', ''].join('\n');
    expect(chatStreamUsage(text)).toEqual({ prompt_tokens: 1200, completion_tokens: 40, cost: 0.00105 });
    expect(chatStreamUsage(chat('no usage yet'))).toBeNull();
  });
});

describe('tips and compare replies', () => {
  it('keeps the first items of an over-long list instead of failing', () => {
    const bean = parseAiJson(beanTipsOutput, JSON.stringify({ summary: 'Bright.', tips: ['a', 'b', 'c', 'd', 'e'], start: null }));
    expect(bean.ok && bean.data.tips).toEqual(['a', 'b', 'c', 'd']);
    const tip = { title: 'Finer', detail: 'One click.' };
    const recipe = parseAiJson(recipeTipsOutput, JSON.stringify({ verdict: 'Good.', tips: [tip, tip, tip, tip, tip], checks: ['1', '2', '3', '4'], next_test: null }));
    expect(recipe.ok && [recipe.data.tips.length, recipe.data.checks.length]).toEqual([4, 3]);
    const changes = Array.from({ length: 10 }, (_, i) => ({ setting: `s${i}`, from: 90, to: '86 °C', why: 'w', how: 'h', cup: 'c' }));
    const compare = parseAiJson(compareOutput, JSON.stringify({ summary: 'Close.', changes, verdict: 'Duel them.', next: 'Taste.' }));
    expect(compare.ok && compare.data.changes.length).toBe(8);
    // Values come back as text, whatever the model wrote them as.
    expect(compare.ok && compare.data.changes[0]).toMatchObject({ from: '90', to: '86 °C' });
    // No tips at all is still wrong, and says so.
    expect(parseAiJson(beanTipsOutput, JSON.stringify({ summary: 'x', tips: [], start: null }))).toMatchObject({ ok: false, error: 'tips: Give 2 to 4 tips.' });
  });
});

describe('experiment changes', () => {
  it('reads the method in any letter case, and nothing else', () => {
    const parse = (method: unknown) =>
      parseAiJson(duelReadOutput, JSON.stringify({ read: 'x', next_test: { title: 't', parent: null, changes: { method }, why: 'w', listenFor: 'l' } }));
    const inverted = parse(' inverted ');
    expect(inverted.ok && inverted.data.next_test?.changes.method).toBe('Inverted');
    expect(parse('upside down').ok).toBe(false);
  });
});
