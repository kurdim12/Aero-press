import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv } from './env';
import type { ApiErrorBody } from '../../shared/types';
import { ApiError } from './lib/errors';
import { authRoutes } from './routes/auth';
import { beanRoutes } from './routes/beans';
import { brewRoutes } from './routes/brews';
import { importRoutes } from './routes/import';
import { memberRoutes } from './routes/members';
import { recipeRoutes } from './routes/recipes';
import { setupRoutes } from './routes/setup';
import { meRoutes, teamRoutes } from './routes/team';

export function createApp() {
  const app = new Hono<AppEnv>().basePath('/api');

  app.use('*', secureHeaders({ crossOriginResourcePolicy: 'same-origin' }));
  app.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  app.route('/setup', setupRoutes);
  app.route('/auth', authRoutes);
  app.route('/me', meRoutes);
  app.route('/members', memberRoutes);
  app.route('/team', teamRoutes);
  app.route('/beans', beanRoutes);
  app.route('/recipes', recipeRoutes);
  app.route('/brews', brewRoutes);
  app.route('/import', importRoutes);

  app.notFound((c) =>
    c.json<ApiErrorBody>(
      { error: { code: 'not_found', message: 'That page of the API does not exist. Reload the app to get the latest version.' } },
      404,
    ),
  );

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json<ApiErrorBody>({ error: { code: err.code, message: err.message, ...err.extra } }, err.status);
    }
    if (err instanceof HTTPException) {
      return c.json<ApiErrorBody>(
        { error: { code: `http_${err.status}`, message: 'The request was refused. Reload the app and try again.' } },
        err.status,
      );
    }
    // Log for `wrangler tail`. Request bodies (which can hold PINs) are never logged.
    console.error('Unhandled API error', c.req.method, c.req.path, err instanceof Error ? err.stack : String(err));
    return c.json<ApiErrorBody>(
      {
        error: {
          code: 'server_error',
          message: 'Something went wrong on our side. Try again in a moment. If it keeps happening, tell the owner.',
        },
      },
      500,
    );
  });

  return app;
}
