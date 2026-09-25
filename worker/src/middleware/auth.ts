import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { notSignedIn, ownerOnly } from '../lib/errors';
import { loadSession } from '../lib/session';

/** Every non-public route: resolve the session and expose the member as c.var.member. */
export const requireMember = createMiddleware<AppEnv>(async (c, next) => {
  const member = await loadSession(c);
  if (!member) throw notSignedIn();
  c.set('member', member);
  await next();
});

/** Owner-only routes. Must run after requireMember. */
export const requireOwner = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get('member').role !== 'owner') throw ownerOnly();
  await next();
});
