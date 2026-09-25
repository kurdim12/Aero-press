import { describe, expect, it } from 'vitest';
import { ELO_START, type EloDuel, replayElo } from '../../shared/elo';

let seq = 0;
const duel = (x: string, y: string, winner: string | null, at: number, bean: string | null = null): EloDuel => ({
  id: `d${++seq}`,
  recipe_x_id: x,
  recipe_y_id: y,
  winner_recipe_id: winner,
  revealed_at: at,
  bean_id: bean,
});

describe('Elo replay', () => {
  it('moves both ratings by 16 when equals meet (K = 32)', () => {
    const table = replayElo([duel('A', 'B', 'A', 1)]);
    expect(table.get('A')).toMatchObject({ elo: 1516, wins: 1, losses: 0, draws: 0, duels: 1 });
    expect(table.get('B')).toMatchObject({ elo: 1484, wins: 0, losses: 1, draws: 0, duels: 1 });
  });

  it('scores a draw as half a win', () => {
    const even = replayElo([duel('A', 'B', null, 1)]);
    expect(even.get('A')?.elo).toBe(ELO_START);
    expect(even.get('A')?.draws).toBe(1);

    // After A beats B, a draw pulls them back together.
    const table = replayElo([duel('A', 'B', 'A', 1), duel('A', 'B', null, 2)]);
    expect(table.get('A')?.elo).toBeCloseTo(1514.53, 2);
    expect(table.get('B')?.elo).toBeCloseTo(1485.47, 2);
    expect(table.get('A')).toMatchObject({ wins: 1, draws: 1, duels: 2 });
  });

  it('replays in revealed_at order, not input order', () => {
    const ordered = [duel('A', 'B', 'A', 1), duel('B', 'C', 'B', 2), duel('C', 'A', 'C', 3)];
    const shuffled = [ordered[2]!, ordered[0]!, ordered[1]!];
    const a = replayElo(ordered);
    const b = replayElo(shuffled);
    for (const id of ['A', 'B', 'C']) expect(b.get(id)?.elo).toBeCloseTo(a.get(id)?.elo ?? 0, 10);
    // Order matters: a different sequence gives different ratings.
    const reversed = replayElo([duel('C', 'A', 'C', 1), duel('B', 'C', 'B', 2), duel('A', 'B', 'A', 3)]);
    expect(reversed.get('A')?.elo).not.toBeCloseTo(a.get('A')?.elo ?? 0, 3);
  });

  it('keeps the total rating constant', () => {
    const table = replayElo([
      duel('A', 'B', 'A', 1),
      duel('B', 'C', null, 2),
      duel('C', 'A', 'C', 3),
      duel('A', 'D', 'D', 4),
    ]);
    const total = [...table.values()].reduce((sum, s) => sum + s.elo, 0);
    expect(total).toBeCloseTo(ELO_START * table.size, 8);
  });

  it('filters by bean', () => {
    const duels = [duel('A', 'B', 'A', 1, 'guji'), duel('A', 'B', 'B', 2, 'pink'), duel('A', 'B', 'B', 3, 'pink')];
    const guji = replayElo(duels, { beanId: 'guji' });
    expect(guji.get('A')).toMatchObject({ elo: 1516, wins: 1, duels: 1 });
    const pink = replayElo(duels, { beanId: 'pink' });
    expect(pink.get('A')).toMatchObject({ wins: 0, losses: 2, duels: 2 });
    expect(pink.get('A')?.elo).toBeLessThan(ELO_START);
    const all = replayElo(duels);
    expect(all.get('A')?.duels).toBe(3);
  });

  it('ignores duels with an unknown winner or the same recipe twice', () => {
    const table = replayElo([duel('A', 'B', 'Z', 1), duel('A', 'A', 'A', 2)]);
    expect(table.size).toBe(0);
  });
});
