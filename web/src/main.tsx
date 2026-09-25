import '@fontsource-variable/archivo/wdth.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, setSignedOutHandler } from './api';
import { App } from './App';
import { clearSessionData } from './session';
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
