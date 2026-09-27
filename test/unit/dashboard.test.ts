import { describe, expect, it } from 'vitest';
import { daysUntil, eloHistory, isUnreliable, lastDays, localDayStart, sampleSd, timedStreak, weekOf } from '../../shared/dashboard';
import { replayElo } from '../../shared/elo';

const AMMAN = 3 * 3600_000;
// 2026-09-27 22:30 UTC is already 2026-09-28 in Amman.
const LATE_EVENING = Date.UTC(2026, 8, 27, 22, 30);

describe('board calculations', () => {
  it('counts days in the team’s time zone', () => {
    expect(daysUntil('2026-10-08', LATE_EVENING, AMMAN)).toBe(10);
    expect(daysUntil('2026-09-28', LATE_EVENING, AMMAN)).toBe(0);
    expect(daysUntil('2026-09-20', LATE_EVENING, AMMAN)).toBe(-8);
    expect(daysUntil(null, LATE_EVENING, AMMAN)).toBeNull();
    expect(daysUntil('soon', LATE_EVENING, AMMAN)).toBeNull();
    const days = lastDays(LATE_EVENING, AMMAN, 3);
    expect(days).toEqual(['2026-09-26', '2026-09-27', '2026-09-28']);
    expect(localDayStart(LATE_EVENING, AMMAN)).toBe(Date.UTC(2026, 8, 27, 21, 0)); // Amman midnight
  });

  it('puts days into Monday-start weeks', () => {
    expect(weekOf('2026-09-28')).toBe('2026-09-28'); // a Monday
    expect(weekOf('2026-10-04')).toBe('2026-09-28'); // the Sunday after
    expect(weekOf('2026-09-27')).toBe('2026-09-21');
  });

  it('measures spread with the sample standard deviation', () => {
    const values = [1.2, 1.5, 1.35];
    const sum = values.reduce((a, b) => a + b, 0);
    const sumSq = values.reduce((a, b) => a + b * b, 0);
    expect(sampleSd(3, sum, sumSq)).toBeCloseTo(0.15, 6);
    expect(sampleSd(1, 1.3, 1.69)).toBeNull();
    expect(sampleSd(4, 4 * 1.3, 4 * 1.69)).toBeCloseTo(0, 6);
    expect(isUnreliable(0.08, 0.2)).toBe(true);
    expect(isUnreliable(0.03, 1.2)).toBe(true);
    expect(isUnreliable(0.03, 0.4)).toBe(false);
    expect(isUnreliable(null, null)).toBe(false);
  });

  it('counts the latest run of brews inside 5:00', () => {
    expect(timedStreak([170, 200, 299, 301, 100])).toBe(3);
    expect(timedStreak([300])).toBe(0);
    expect(timedStreak([])).toBe(0);
  });

  it('tracks a recipe’s Elo after each duel, ending where the table does', () => {
    const duels = [
      { id: 'd1', recipe_x_id: 'a', recipe_y_id: 'b', winner_recipe_id: 'a', revealed_at: 1, bean_id: null },
      { id: 'd2', recipe_x_id: 'b', recipe_y_id: 'c', winner_recipe_id: null, revealed_at: 2, bean_id: null },
      { id: 'd3', recipe_x_id: 'a', recipe_y_id: 'c', winner_recipe_id: 'c', revealed_at: 3, bean_id: null },
    ];
    const history = eloHistory(duels, ['a', 'b']);
    expect(history.get('a')?.map((p) => p.t)).toEqual([1, 3]);
    expect(history.get('a')?.[0]?.elo).toBe(1516);
    expect(history.get('b')?.map((p) => p.t)).toEqual([1, 2]);
    expect(history.get('a')?.at(-1)?.elo).toBe(Math.round(replayElo(duels).get('a')!.elo));
  });
});
