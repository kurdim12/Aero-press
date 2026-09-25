import '@fontsource-variable/archivo/wdth.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BeansResponse, MeResponse, RecipesResponse } from '../../shared/types';
import { ApiError, setSignedOutHandler } from './api';
import { App } from './App';
import { loadSnapshot, rememberData, rememberMe } from './offline/snapshot';
import { beansQuery, recipesQuery } from './queries';
import { clearSessionData, meQuery, setupStatusQuery } from './session';
import { applyTheme, getThemePref, watchSystemTheme } from './theme';

applyTheme(getThemePref());
watchSystemTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry network and server hiccups, never "you did something wrong" answers.
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

setSignedOutHandler(() => clearSessionData(queryClient));

// Open instantly (and offline) with the last data this phone saw; fresh data replaces it
// as soon as the network answers.
const allRecipesKey = recipesQuery('all', null).queryKey;
const snapshot = loadSnapshot();
if (snapshot) {
  const at = { updatedAt: snapshot.saved_at };
  queryClient.setQueryData(setupStatusQuery.queryKey, { needs_setup: false });
  queryClient.setQueryData(meQuery.queryKey, snapshot.me, at);
  if (snapshot.recipes) queryClient.setQueryData(allRecipesKey, snapshot.recipes, at);
  if (snapshot.beans) queryClient.setQueryData(beansQuery.queryKey, snapshot.beans, at);
}
queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== 'updated' || event.action.type !== 'success') return;
  const [key, scope, bean] = event.query.queryKey as unknown[];
  const data = event.query.state.data;
  if (key === 'me') rememberMe(data as MeResponse | null);
  else if (key === 'recipes' && scope === 'all' && bean === null) rememberData({ recipes: data as RecipesResponse });
  else if (key === 'beans') rememberData({ beans: data as BeansResponse });
});

// The service worker caches the app shell so the app and the brew timer open offline.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Not fatal: the app still works online.
    });
  });
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
}
