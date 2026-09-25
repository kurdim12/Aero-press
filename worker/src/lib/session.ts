import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv, AuthMember } from '../env';
import type { Role } from '../../../shared/types';
import { newSessionToken, sha256Base64 } from './crypto';
import { newId } from './ids';

export const SESSION_COOKIE = 'ap_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Hosts where plain http is expected during development (laptop or phone on the same Wi-Fi). */
function isDevHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return true;
  if (hostname === '[::1]' || hostname === '0.0.0.0' || hostname.startsWith('127.')) return true;
  if (hostname.startsWith('10.') || hostname.startsWith('192.168.')) return true;
  const m = /^172\.(\d+)\./.exec(hostname);
  return m !== null && Number(m[1]) >= 16 && Number(m[1]) <= 31;
}

/**
 * Cookies are always `Secure` in production. Only a plain-http request to a
 * local or private-network host (wrangler dev) gets a non-Secure cookie, so
 * sign-in also works from a phone on the same Wi-Fi during development.
 */
export function cookieIsSecure(c: Context<AppEnv>): boolean {
  const url = new URL(c.req.url);
  return url.protocol === 'https:' || !isDevHost(url.hostname);
}

export async function startSession(c: Context<AppEnv>, memberId: string): Promise<string> {
  const token = newSessionToken();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  const sessionId = newId();
  await c.env.DB.prepare(
    'INSERT INTO sessions (id, member_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(sessionId, memberId, await sha256Base64(token), expiresAt, now)
    .run();
  setCookie(c, SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: cookieIsSecure(c),
    sameSite: 'Lax',
    expires: new Date(expiresAt),
  });
  return sessionId;
}

export async function endSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Base64(token)).run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: cookieIsSecure(c) });
}

interface SessionRow {
  session_id: string;
  expires_at: number;
  id: string;
  team_id: string;
  name: string;
  role: Role;
}

/** Resolve the session cookie to an active member, or null. */
export async function loadSession(c: Context<AppEnv>): Promise<AuthMember | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || token.length > 128) return null;
  const row = await c.env.DB.prepare(
    `SELECT s.id AS session_id, s.expires_at, m.id, m.team_id, m.name, m.role
       FROM sessions s JOIN members m ON m.id = s.member_id
      WHERE s.token_hash = ? AND m.active = 1`,
  )
    .bind(await sha256Base64(token))
    .first<SessionRow>();
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(row.session_id).run();
    return null;
  }
  return { id: row.id, team_id: row.team_id, name: row.name, role: row.role, session_id: row.session_id };
}
