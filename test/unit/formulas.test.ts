import { describe, expect, it } from 'vitest';
import { brewRatio, daysOffRoast, extractionYield } from '../../shared/formulas';

describe('extraction yield', () => {
  it('is TDS % × beverage g ÷ dose g, rounded to 2 places', () => {
    expect(extractionYield(1.32, 245, 18)).toBe(17.97);
    expect(extractionYield(1.35, 230, 18)).toBe(17.25);
    expect(extractionYield(1.4, 200, 20)).toBe(14);
  });

  it('needs all three values', () => {
    expect(extractionYield(null, 245, 18)).toBeNull();
    expect(extractionYield(1.32, undefined, 18)).toBeNull();
    expect(extractionYield(1.32, 245, null)).toBeNull();
  });

  it('refuses a zero dose and negative inputs', () => {
    expect(extractionYield(1.32, 245, 0)).toBeNull();
    expect(extractionYield(-1, 245, 18)).toBeNull();
    expect(extractionYield(1.32, -5, 18)).toBeNull();
    expect(extractionYield(Number.NaN, 245, 18)).toBeNull();
  });
});

describe('brew ratio', () => {
  it('is water ÷ dose', () => {
    expect(brewRatio(250, 18)).toBeCloseTo(13.889, 3);
    expect(brewRatio(240, 16)).toBe(15);
  });

  it('needs both values and a positive dose', () => {
    expect(brewRatio(null, 18)).toBeNull();
    expect(brewRatio(250, 0)).toBeNull();
  });
});

describe('days off roast', () => {
  const today = new Date(2026, 8, 25); // 25 Sep 2026, local time

  it('counts whole days from the roast date', () => {
    expect(daysOffRoast('2026-09-25', today)).toBe(0);
    expect(daysOffRoast('2026-09-02', today)).toBe(23);
    expect(daysOffRoast('2026-08-25', today)).toBe(31);
  });

  it('is null without a valid date', () => {
    expect(daysOffRoast(null, today)).toBeNull();
    expect(daysOffRoast('25/09/2026', today)).toBeNull();
  });
});
