import { applyD1Migrations, reset } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import type { MeResponse } from '../../shared/types';

/** Wipe D1 and re-apply migrations so each test starts from an empty deployment. */
export async function freshDb(): Promise<void> {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
}

export interface TestResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

/** A browser-like client that keeps its own session cookie. */
export class Client {
  cookie = '';

  constructor(readonly origin = 'https://lab.example') {}

  async request<T = any>(method: string, path: string, body?: unknown): Promise<TestResponse<T>> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.cookie) headers.cookie = this.cookie;
    const res = await exports.default.fetch(
      new Request(this.origin + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const pair = setCookie.split(';')[0] ?? '';
      const value = pair.slice(pair.indexOf('=') + 1);
      this.cookie = value ? pair : '';
    }
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T, headers: res.headers };
  }

  get<T = any>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T = any>(path: string, body: unknown = {}) {
    return this.request<T>('POST', path, body);
  }
  put<T = any>(path: string, body: unknown = {}) {
    return this.request<T>('PUT', path, body);
  }
  patch<T = any>(path: string, body: unknown = {}) {
    return this.request<T>('PATCH', path, body);
  }
  delete<T = any>(path: string) {
    return this.request<T>('DELETE', path);
  }
}

export const OWNER_PIN = '246810';
export const TEAM_PIN = '1357';

/** Set up a team and return the signed-in owner client. */
export async function setupTeam(): Promise<{ owner: Client; me: MeResponse }> {
  const owner = new Client();
  const res = await owner.post<MeResponse>('/api/setup', {
    team_name: 'Kurdi Coffee Lab',
    owner_name: 'Abdelrahman Kurdi',
    owner_pin: OWNER_PIN,
    team_pin: TEAM_PIN,
  });
  if (res.status !== 201) throw new Error(`setup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { owner, me: res.body };
}

/** Owner adds a barista; returns the new member id. */
export async function addBarista(owner: Client, name: string): Promise<string> {
  const res = await owner.post<{ id: string }>('/api/members', { name });
  if (res.status !== 201) throw new Error(`add member failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id;
}

export async function signIn(memberId: string, pin: string): Promise<{ client: Client; res: TestResponse }> {
  const client = new Client();
  const res = await client.post('/api/auth/login', { member_id: memberId, pin });
  return { client, res };
}
