// The recipe last brewed on this phone, so it's one tap away next time.
import { browserStore } from '../offline/storage';

const KEY = 'ap-last-brewed';
const store = browserStore();

export function lastBrewedRecipeId(): string | null {
  try {
    return store.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberBrewedRecipe(recipeId: string): void {
  try {
    store.setItem(KEY, recipeId);
  } catch {
    // Convenience only.
  }
}
