import { describe, expect, it } from 'vitest';
import { compareKey, orient, parseRef, refKey, stepsBetween } from '../../shared/compare';

// A family: base → v2 → v3, and a separate recipe made later.
const parents: Record<string, string | null> = { base: null, v2: 'base', v3: 'v2', other: null };
const parentOf = (id: string) => parents[id] ?? null;
const recipe = (id: string, created_at: number) => ({ kind: 'recipe' as const, id, parent_id: parents[id] ?? null, created_at });
const champion = (id: string, year: number, place = 1) => ({ kind: 'champion' as const, id, year, place });

describe('comparing two recipes', () => {
  it('reads sides from links, old and new', () => {
    expect(parseRef('recipe:abc')).toEqual({ kind: 'recipe', id: 'abc' });
    expect(parseRef('champion:wac-2019-1')).toEqual({ kind: 'champion', id: 'wac-2019-1' });
    expect(parseRef('abc')).toEqual({ kind: 'recipe', id: 'abc' }); // older links carry a bare id
    expect(parseRef('recipe:')).toBeNull();
    expect(parseRef('')).toBeNull();
    expect(refKey({ kind: 'champion', id: 'x' })).toBe('champion:x');
    expect(compareKey({ kind: 'recipe', id: 'b' }, { kind: 'champion', id: 'a' })).toBe(compareKey({ kind: 'champion', id: 'a' }, { kind: 'recipe', id: 'b' }));
  });

  it('counts the versions between a recipe and its ancestors', () => {
    expect(stepsBetween('base', 'v2', parentOf)).toBe(1);
    expect(stepsBetween('base', 'v3', parentOf)).toBe(2);
    expect(stepsBetween('v3', 'base', parentOf)).toBeNull();
    expect(stepsBetween('other', 'v3', parentOf)).toBeNull();
    // A loop in bad data ends instead of spinning.
    const loop = (id: string) => (id === 'a' ? 'b' : 'a');
    expect(stepsBetween('z', 'a', loop)).toBeNull();
  });

  it('puts the old version first, whichever was picked first', () => {
    expect(orient(recipe('v3', 300), recipe('base', 100), parentOf)).toEqual({ first: 1, framing: 'versions', steps: 2 });
    expect(orient(recipe('base', 100), recipe('v2', 200), parentOf)).toEqual({ first: 0, framing: 'versions', steps: 1 });
    // Unrelated recipes: the older one first.
    expect(orient(recipe('other', 400), recipe('v2', 200), parentOf)).toEqual({ first: 1, framing: 'recipes', steps: null });
  });

  it('puts a champion before ours, and the earlier champion first', () => {
    expect(orient(recipe('base', 100), champion('wac-2019-1', 2019), parentOf)).toMatchObject({ first: 1, framing: 'champion_ours' });
    expect(orient(champion('wac-2024-1', 2024), champion('wac-2017-1', 2017), parentOf)).toMatchObject({ first: 1, framing: 'champions' });
    expect(orient(champion('wac-2018-1', 2018, 1), champion('wac-2018-3', 2018, 3), parentOf)).toMatchObject({ first: 0, framing: 'champions' });
  });
});
