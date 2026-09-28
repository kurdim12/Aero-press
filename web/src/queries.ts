import { queryOptions, type QueryClient } from '@tanstack/react-query';
import type {
  BaristaStandingsResponse,
  BeanRow,
  BeansResponse,
  DuelView,
  DuelsResponse,
  RecipeDetailResponse,
  RecipesResponse,
} from '../../shared/types';
import { api } from './api';

export type RecipeScope = 'all' | 'mine';

export const beansQuery = queryOptions({
  queryKey: ['beans'],
  queryFn: () => api<BeansResponse>('GET', '/api/beans'),
});

export const beanQuery = (id: string) =>
  queryOptions({
    queryKey: ['bean', id],
    queryFn: () => api<BeanRow>('GET', `/api/beans/${encodeURIComponent(id)}`),
  });

export const recipesQuery = (scope: RecipeScope = 'all', beanId: string | null = null) =>
  queryOptions({
    queryKey: ['recipes', scope, beanId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (scope === 'mine') params.set('scope', 'mine');
      if (beanId) params.set('bean', beanId);
      const qs = params.toString();
      return api<RecipesResponse>('GET', `/api/recipes${qs ? `?${qs}` : ''}`);
    },
  });

export const recipeQuery = (id: string) =>
  queryOptions({
    queryKey: ['recipe', id],
    queryFn: () => api<RecipeDetailResponse>('GET', `/api/recipes/${encodeURIComponent(id)}`),
  });

export const duelsQuery = queryOptions({
  queryKey: ['duels'],
  queryFn: () => api<DuelsResponse>('GET', '/api/duels'),
});

/** The baristas' ranking: read when the Duel tab opens, refreshed after a reveal (not polled). */
export const baristaStandingsQuery = queryOptions({
  queryKey: ['barista-standings'],
  queryFn: () => api<BaristaStandingsResponse>('GET', '/api/duels/standings'),
  staleTime: 60_000,
});

export const duelQuery = (id: string) =>
  queryOptions({
    queryKey: ['duel', id],
    queryFn: () => api<DuelView>('GET', `/api/duels/${encodeURIComponent(id)}`),
  });

export const isDuelFinished = (d: Pick<DuelView, 'status'>) => d.status === 'revealed' || d.status === 'cancelled';

/** After any change to beans or recipes, refetch the lists and details that show them. */
export function invalidateLibrary(qc: QueryClient): Promise<void> {
  return Promise.all(
    ['recipes', 'recipe', 'beans', 'bean'].map((key) => qc.invalidateQueries({ queryKey: [key] })),
  ).then(() => undefined);
}
