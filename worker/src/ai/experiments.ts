// Turning the coach's experiments into ones the app can act on: parent codes resolved to recipes,
// and a bean named in the changes resolved to the team's bean (or dropped).
import type { z } from 'zod';
import type { Experiment, RecipeChanges, RecipeRow } from '../../../shared/types';
import type { experimentOutput } from '../../../shared/schemas';
import { findRecipeByCode } from './context';

export interface TeamBean {
  id: string;
  name: string;
}

function beanIdFor(value: string, beans: TeamBean[]): string | null {
  const wanted = value.trim().toLowerCase();
  return beans.find((b) => b.id === value || b.name.toLowerCase() === wanted)?.id ?? null;
}

/** A "change" to the value the parent already has isn't a change: it would only clutter the card. */
function sameAsParent(key: keyof RecipeChanges, value: unknown, parent: RecipeRow): boolean {
  if (key === 'name' || key === 'notes') return false;
  const current = parent[key];
  if (typeof value === 'number' || typeof current === 'number') return current !== null && Number(value) === Number(current);
  return typeof value === 'string' && typeof current === 'string' && value.trim().toLowerCase() === current.trim().toLowerCase();
}

export function toExperiment(
  raw: z.output<typeof experimentOutput>,
  recipes: RecipeRow[],
  beans: TeamBean[],
  force: { parent?: RecipeRow; beanId?: string } = {},
): Experiment {
  const parent = force.parent ?? findRecipeByCode(recipes, raw.parent);
  const changes: RecipeChanges = { ...raw.changes };
  if (changes.bean_id) {
    const beanId = beanIdFor(changes.bean_id, beans);
    if (beanId) changes.bean_id = beanId;
    else delete changes.bean_id;
  }
  if (parent) {
    for (const key of Object.keys(changes) as (keyof RecipeChanges)[]) {
      if (sameAsParent(key, changes[key], parent)) delete changes[key];
    }
  }
  if (force.beanId) changes.bean_id = force.beanId;
  return {
    title: raw.title,
    parent: parent?.display_code ?? raw.parent,
    parent_id: parent?.id ?? null,
    changes,
    why: raw.why,
    listenFor: raw.listenFor,
  };
}
