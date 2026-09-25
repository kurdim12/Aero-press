import { applyD1Migrations, reset } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { IMPORT_CHUNK_MAX, type ImportResult, type MeResponse } from '../../shared/types';
import fixture from '../../test/fixtures/v1-backup.json';
import { chunk, planV1Import } from '../../shared/v1import';

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

// ---------- Phase 2 helpers ----------

/** Import a v1 backup the way the web app does: map in "the browser", then send chunks. */
export async function importV1(owner: Client, data: unknown = fixture): Promise<ImportResult[]> {
  const planned = planV1Import(data);
  if (!planned.ok) throw new Error(`plan failed: ${planned.error}`);
  const { plan } = planned;
  const results: ImportResult[] = [];
  for (const kind of ['beans', 'recipes', 'brews', 'duels'] as const) {
    for (const records of chunk<object>(plan[kind], IMPORT_CHUNK_MAX)) {
      const res = await owner.post<ImportResult>('/api/import/v1', { kind, records });
      if (res.status !== 200) throw new Error(`import ${kind} failed: ${res.status} ${JSON.stringify(res.body)}`);
      results.push(res.body);
    }
  }
  if (plan.settings) {
    const res = await owner.post<ImportResult>('/api/import/v1', { kind: 'settings', settings: plan.settings });
    if (res.status !== 200) throw new Error(`import settings failed: ${res.status} ${JSON.stringify(res.body)}`);
    results.push(res.body);
  }
  return results;
}

export const resultFor = (results: ImportResult[], kind: ImportResult['kind']) => {
  const found = results.find((r) => r.kind === kind);
  if (!found) throw new Error(`no ${kind} result`);
  return found;
};

/** Minimal valid recipe body for the create endpoint. */
export const recipeBody = (overrides: Record<string, unknown> = {}) => ({
  name: 'Test recipe',
  method: 'Inverted',
  dose_g: 18,
  water_g: 250,
  temp_c: 90,
  bloom_ends_s: 30,
  press_starts_s: 105,
  press_duration_s: 30,
  ...overrides,
});
