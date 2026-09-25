import type { Env } from './env';
import { createApp } from './app';

const app = createApp();

export default {
  fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return app.fetch(request, env, ctx);
    // Static assets normally never reach the Worker (run_worker_first is /api/* only).
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
