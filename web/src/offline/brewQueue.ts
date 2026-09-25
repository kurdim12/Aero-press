// Brews saved while offline wait here and sync when the connection is back.
// Pure (storage and sender are injected), so it's unit tested in Node.
import type { BrewInput } from '../../../shared/schemas';
import type { BrewRow } from '../../../shared/types';
import { type KeyValueStore, readJson, writeJson } from './storage';

export const QUEUE_KEY = 'ap-brew-queue-v1';

export type QueuedBody = BrewInput & { id: string; brewed_at: number };

export interface QueuedBrew {
  /** Same as body.id, made on the phone, so a retry can never create a second brew. */
  id: string;
  /** Only the member who logged it may send it. */
  member_id: string;
  body: QueuedBody;
  /** Recipe code and name, for the waiting list. */
  label: string;
  queued_at: number;
  /** Set when the server refused it; it waits for the member to discard it. */
  error?: string;
}

/** What the sender throws: the shape of the web app's ApiError. */
export interface SendError {
  status: number;
  code: string;
  message: string;
}

export type Sender = (body: QueuedBody) => Promise<BrewRow>;

export type StopReason = 'offline' | 'signed_out' | 'server';

export interface SyncResult {
  sent: number;
  refused: number;
  stopped: StopReason | null;
}

const isSendError = (e: unknown): e is SendError =>
  typeof e === 'object' && e !== null && typeof (e as SendError).status === 'number' && typeof (e as SendError).code === 'string';

export class BrewQueue {
  private listeners = new Set<() => void>();
  private syncing: Promise<SyncResult> | null = null;

  constructor(
    private readonly store: KeyValueStore,
    private readonly send: Sender,
  ) {}

  all(): QueuedBrew[] {
    return readJson<QueuedBrew[]>(this.store, QUEUE_KEY) ?? [];
  }

  forMember(memberId: string): QueuedBrew[] {
    return this.all().filter((q) => q.member_id === memberId);
  }

  add(item: QueuedBrew): void {
    this.save([...this.all().filter((q) => q.id !== item.id), item]);
  }

  remove(id: string): void {
    this.save(this.all().filter((q) => q.id !== id));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Send this member's waiting brews, oldest first. Stops at the first sign that sending
   * can't work right now (offline, signed out, server trouble); a brew the server refuses
   * is kept with the reason, so nothing is lost silently. One sync runs at a time.
   */
  sync(memberId: string): Promise<SyncResult> {
    this.syncing ??= this.run(memberId).finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  private async run(memberId: string): Promise<SyncResult> {
    const result: SyncResult = { sent: 0, refused: 0, stopped: null };
    const waiting = this.forMember(memberId)
      .filter((q) => !q.error)
      .sort((a, b) => a.queued_at - b.queued_at);
    for (const item of waiting) {
      try {
        await this.send(item.body);
        this.remove(item.id);
        result.sent++;
      } catch (err) {
        if (!isSendError(err) || err.code === 'offline' || err.status === 0) {
          result.stopped = 'offline';
        } else if (err.status === 401) {
          result.stopped = 'signed_out';
        } else if (err.status >= 500) {
          result.stopped = 'server';
        } else {
          this.save(this.all().map((q) => (q.id === item.id ? { ...q, error: err.message } : q)));
          result.refused++;
          continue;
        }
        break;
      }
    }
    return result;
  }

  private save(items: QueuedBrew[]): void {
    writeJson(this.store, QUEUE_KEY, items.length ? items : null);
    for (const listener of this.listeners) listener();
  }
}
