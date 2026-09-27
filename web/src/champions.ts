// The World champion recipe library, loaded the first time a screen needs it (it's a separate
// download, so the app's first load stays small).
import { queryOptions } from '@tanstack/react-query';

export const championsQuery = queryOptions({
  queryKey: ['champion-recipes'],
  queryFn: async () => (await import('../../shared/champions')).CHAMPION_RECIPES,
  staleTime: Infinity,
  gcTime: Infinity,
});
