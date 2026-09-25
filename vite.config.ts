import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The web app lives in /web and builds to /dist, which wrangler serves as
// static assets next to the Worker API (see wrangler.jsonc).
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    // `npm run dev:web` gives hot reload; API calls go to a running `wrangler dev`.
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
});
