// The app's brew queue: save now if possible, otherwise keep the brew on the phone and
// send it when the connection is back.
import { useSyncExternalStore } from 'react';
import type { BrewRow } from '../../../shared/types';
import { ApiError, api } from '../api';
import { BrewQueue, type QueuedBody, type QueuedBrew } from './brewQueue';
import { browserStore } from './storage';

export const brewQueue = new BrewQueue(browserStore(), (body) => api<BrewRow>('POST', '/api/brews', body));

export type SubmitResult = { saved: BrewRow } | { queued: QueuedBrew };

/**
 * Save a brew. Offline, or when the network or server fails, it's queued instead; a
 * refusal (bad input, missing recipe) is thrown so the form can show it.
 */
export async function submitBrew(body: QueuedBody, memberId: string, label: string): Promise<SubmitResult> {
  const queue = (): SubmitResult => {
    const item: QueuedBrew = { id: body.id, member_id: memberId, body, label, queued_at: Date.now() };
    brewQueue.add(item);
    return { queued: item };
  };
  if (!navigator.onLine) return queue();
  try {
    return { saved: await api<BrewRow>('POST', '/api/brews', body) };
  } catch (err) {
    if (err instanceof ApiError && (err.code === 'offline' || err.status >= 500)) return queue();
    throw err;
  }
}

/** Sync whenever the phone comes back online, returns to the app, or every minute. */
export function startBrewSync(memberId: string, onSent: () => void): () => void {
  const run = () => {
    if (!navigator.onLine || brewQueue.forMember(memberId).every((q) => q.error)) return;
    void brewQueue.sync(memberId).then((r) => {
      if (r.sent > 0) onSent();
    });
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') run();
  };
  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', onVisible);
  const timer = window.setInterval(run, 60_000);
  run();
  return () => {
    window.removeEventListener('online', run);
    document.removeEventListener('visibilitychange', onVisible);
    window.clearInterval(timer);
  };
}

/** This member's brews waiting on the phone (including any the server refused). */
export function useQueuedBrews(memberId: string): QueuedBrew[] {
  const snapshot = useSyncExternalStore(
    (listener) => brewQueue.subscribe(listener),
    () => JSON.stringify(brewQueue.forMember(memberId)),
  );
  return JSON.parse(snapshot) as QueuedBrew[];
}
