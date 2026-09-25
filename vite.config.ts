import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const fromRoot = (path: string) => new URL(path, import.meta.url);

/** Files in web/public that belong to the app shell. */
const PUBLIC_SHELL = ['theme-init.js', 'favicon.svg'];

/**
 * Emits sw.js with the list of built files to precache, so the app opens offline.
 * The version changes whenever any shell file changes, which makes phones update.
 */
function serviceWorker(): Plugin {
  return {
    name: 'aeropress-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((file) => file !== 'index.html' && !file.endsWith('.map'));
      const shell = ['/', ...PUBLIC_SHELL.map((f) => `/${f}`), ...built.map((f) => `/${f}`)];
      const template = readFileSync(fromRoot('./web/sw-template.js'), 'utf8');
      const hash = createHash('sha256').update(template).update(shell.join('\n'));
      for (const file of PUBLIC_SHELL) hash.update(readFileSync(fromRoot(`./web/public/${file}`)));
      const version = hash.digest('hex').slice(0, 12);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template.replace("'__VERSION__'", JSON.stringify(version)).replace('__SHELL__', JSON.stringify(shell)),
      });
    },
  };
}

// The web app lives in /web and builds to /dist, which wrangler serves as static assets
// next to the Worker API (see wrangler.jsonc).
export default defineConfig({
  root: 'web',
  plugins: [react(), serviceWorker()],
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
