// Comparing two recipes: which one comes first, and how the coach frames the pair. The compare
// screen and the Worker both use this, so the table and the coach's explanation always agree.
import type { CompareFraming, CompareRef } from './types';

/** "recipe:<id>" or "champion:<id>": how a side travels in URLs and keys. */
export const refKey = (ref: CompareRef): string => `${ref.kind}:${ref.id}`;

/** A side from a URL value. Anything without a known prefix is a team recipe id (older links). */
export function parseRef(value: string | null | undefined): CompareRef | null {
  if (!value) return null;
  for (const kind of ['recipe', 'champion'] as const) {
    if (value.startsWith(`${kind}:`)) {
      const id = value.slice(kind.length + 1);
      return id ? { kind, id } : null;
    }
  }
  return { kind: 'recipe', id: value };
}

export const sameRef = (a: CompareRef, b: CompareRef) => a.kind === b.kind && a.id === b.id;

/** The kept explanation of a pair, the same whichever order the two were picked in. */
export const compareKey = (a: CompareRef, b: CompareRef) => `compare:${[refKey(a), refKey(b)].sort().join('|')}`;

/** What ordering needs to know about a side. */
export type Sided =
  | { kind: 'recipe'; id: string; parent_id: string | null; created_at: number }
  | { kind: 'champion'; id: string; year: number; place: number };

export interface Orientation {
  /** 0 when `a` comes first, 1 when `b` does. */
  first: 0 | 1;
  framing: CompareFraming;
  /** For versions: how many versions separate them (1 = the newer was cloned from the older). */
  steps: number | null;
}

/** How many versions down `id`'s family `ancestor` is (1 = cloned straight from it), or null. */
export function stepsBetween(ancestor: string, id: string, parentOf: (id: string) => string | null | undefined): number | null {
  let current = parentOf(id);
  for (let steps = 1; current && steps <= 100; steps++) {
    if (current === ancestor) return steps;
    current = parentOf(current);
  }
  return null;
}

/**
 * Old before new: a version comes after the recipe it came from, and otherwise the older recipe
 * comes first. A champion's recipe comes before ours, and the earlier champion before the later.
 */
export function orient(a: Sided, b: Sided, parentOf: (id: string) => string | null | undefined): Orientation {
  if (a.kind === 'recipe' && b.kind === 'recipe') {
    const down = stepsBetween(a.id, b.id, parentOf);
    if (down !== null) return { first: 0, framing: 'versions', steps: down };
    const up = stepsBetween(b.id, a.id, parentOf);
    if (up !== null) return { first: 1, framing: 'versions', steps: up };
    return { first: a.created_at <= b.created_at ? 0 : 1, framing: 'recipes', steps: null };
  }
  if (a.kind === 'champion' && b.kind === 'champion') {
    const aFirst = a.year < b.year || (a.year === b.year && a.place <= b.place);
    return { first: aFirst ? 0 : 1, framing: 'champions', steps: null };
  }
  return { first: a.kind === 'champion' ? 0 : 1, framing: 'champion_ours', steps: null };
}
