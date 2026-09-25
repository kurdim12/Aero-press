// The last data this phone saw, so the app (and the brew timer) opens without a connection.
import type { BeansResponse, MeResponse, RecipesResponse } from '../../../shared/types';
import { browserStore, readJson, writeJson } from './storage';

const KEY = 'ap-offline-v1';
const store = browserStore();

export interface Snapshot {
  me: MeResponse;
  /** All team recipes (no filter), which the brew picker and timer need. */
  recipes?: RecipesResponse;
  beans?: BeansResponse;
  saved_at: number;
}

export function loadSnapshot(): Snapshot | null {
  return readJson<Snapshot>(store, KEY);
}

/** A new member (or none) starts a fresh snapshot, so one person never sees another's data. */
export function rememberMe(me: MeResponse | null): void {
  if (!me) {
    forgetSnapshot();
    return;
  }
  const current = loadSnapshot();
  const sameMember = current?.me.member.id === me.member.id;
  writeJson(store, KEY, sameMember ? { ...current, me, saved_at: Date.now() } : { me, saved_at: Date.now() });
}

export function rememberData(part: Pick<Snapshot, 'recipes'> | Pick<Snapshot, 'beans'>): void {
  const current = loadSnapshot();
  if (current) writeJson(store, KEY, { ...current, ...part, saved_at: Date.now() });
}

export function forgetSnapshot(): void {
  writeJson(store, KEY, null);
}
