// Prefilled forms: an AI experiment or a champion recipe opens the recipe form filled in, and a
// quick log opens the brew log filled in. Drafts live in memory for this page load, keyed by a
// token in the URL; after a reload the form simply opens without them.
import type { QuickLogResponse, RecipeChanges } from '../../shared/types';
import { newClientId } from './ids';

export interface RecipeDraft {
  changes: RecipeChanges;
  /** Added above the notes: why, what to listen for, or where a recipe came from. */
  note: string | null;
}

export type BrewDraft = Omit<QuickLogResponse, 'recipeMatch' | 'beanMatch' | 'recipe_id'>;

const recipeDrafts = new Map<string, RecipeDraft>();
const brewDrafts = new Map<string, BrewDraft>();

const token = () => newClientId().slice(0, 12);

export function stashRecipeDraft(draft: RecipeDraft): string {
  const key = token();
  recipeDrafts.set(key, draft);
  return key;
}

export const peekRecipeDraft = (key: string | null): RecipeDraft | null => (key ? (recipeDrafts.get(key) ?? null) : null);

export function stashBrewDraft(draft: BrewDraft): string {
  const key = token();
  brewDrafts.set(key, draft);
  return key;
}

export const peekBrewDraft = (key: string | null): BrewDraft | null => (key ? (brewDrafts.get(key) ?? null) : null);
