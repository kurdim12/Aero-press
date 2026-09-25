import { describe, expect, it } from 'vitest';
import { type PlanInput, phaseIndexAt, planBrew } from '../../shared/phases';

const recipe = (overrides: Partial<PlanInput> = {}): PlanInput => ({
  method: 'Inverted',
  bloom_ends_s: 30,
  press_starts_s: 105,
  press_duration_s: 30,
  bypass_g: null,
  ...overrides,
});

const shape = (input: PlanInput) => planBrew(input).phases.map((p) => [p.kind, p.start, p.end]);

describe('brew phases', () => {
  it('inverted: bloom, steep, flip, press, bypass, pour', () => {
    expect(shape(recipe({ bypass_g: 40 }))).toEqual([
      ['bloom', 0, 30],
      ['steep', 30, 105],
      ['flip', 105, 115],
      ['press', 115, 145],
      ['bypass', 145, 160],
      ['pour', 160, 175],
    ]);
    expect(planBrew(recipe({ bypass_g: 40 }))).toMatchObject({ total: 175, fits: true, missing: [] });
  });

  it('standard has no flip, and no bypass step without bypass water', () => {
    expect(shape(recipe({ method: 'Standard', press_starts_s: 120, bypass_g: 0 }))).toEqual([
      ['bloom', 0, 30],
      ['steep', 30, 120],
      ['press', 120, 150],
      ['pour', 150, 165],
    ]);
  });

  it('starts with the steep when there is no bloom', () => {
    expect(shape(recipe({ bloom_ends_s: null }))[0]).toEqual(['steep', 0, 105]);
    expect(shape(recipe({ bloom_ends_s: 0 }))[0]).toEqual(['steep', 0, 105]);
  });

  it('skips a steep that would end before the bloom (bad imported data)', () => {
    expect(shape(recipe({ bloom_ends_s: 60, press_starts_s: 45 })).map(([kind]) => kind)).toEqual(['bloom', 'flip', 'press', 'pour']);
  });

  it('stops after the bloom when press times are missing', () => {
    const plan = planBrew(recipe({ press_starts_s: null, press_duration_s: null }));
    expect(plan.phases.map((p) => p.kind)).toEqual(['bloom']);
    expect(plan.missing).toEqual(['press_starts_s', 'press_duration_s']);
  });
});

describe('5-minute check', () => {
  it('fits at exactly 5:00 and not a second more', () => {
    // Standard: steep to 255, press 30, pour 15 = 300.
    expect(planBrew(recipe({ method: 'Standard', bloom_ends_s: 30, press_starts_s: 255 }))).toMatchObject({ total: 300, fits: true });
    expect(planBrew(recipe({ method: 'Standard', bloom_ends_s: 30, press_starts_s: 256 }))).toMatchObject({ total: 301, fits: false });
  });

  it('counts the flip and bypass toward the window', () => {
    // 255 steep end + 10 flip + 30 press + 15 bypass + 15 pour = 325.
    expect(planBrew(recipe({ press_starts_s: 255, bypass_g: 30 }))).toMatchObject({ total: 325, fits: false });
  });
});

describe('phase at a moment', () => {
  const plan = planBrew(recipe({ bypass_g: 40 }));

  it('switches exactly at each boundary', () => {
    expect(phaseIndexAt(plan, 0)).toBe(0);
    expect(phaseIndexAt(plan, 29.9)).toBe(0);
    expect(phaseIndexAt(plan, 30)).toBe(1);
    expect(phaseIndexAt(plan, 105)).toBe(2);
    expect(phaseIndexAt(plan, 174.9)).toBe(5);
  });

  it('is done after the last phase', () => {
    expect(phaseIndexAt(plan, 175)).toBe(6);
    expect(phaseIndexAt(plan, 400)).toBe(6);
  });
});
