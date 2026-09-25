import { describe, expect, it } from 'vitest';
import type { BrewRow } from '../../shared/types';
import { BrewQueue, type QueuedBody, type QueuedBrew, type SendError } from '../../web/src/offline/brewQueue';
import type { KeyValueStore } from '../../web/src/offline/storage';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

let n = 0;
const queued = (memberId: string, overrides: Partial<QueuedBrew> = {}): QueuedBrew => {
  const id = `brew-id-000000000${++n}`;
  return {
    id,
    member_id: memberId,
    body: { id, recipe_id: 'r1', brewed_at: 1000 + n, total_time_s: 170 },
    label: 'AK-R1',
    queued_at: n,
    ...overrides,
  };
};

const fail = (status: number, code: string, message = 'nope'): SendError => ({ status, code, message });

describe('brew queue', () => {
  it('keeps brews across reloads (in storage) and sends them oldest first', async () => {
    const store = memoryStore();
    const sent: string[] = [];
    const queue = new BrewQueue(store, async (body: QueuedBody) => {
      sent.push(body.id);
      return { id: body.id } as BrewRow;
    });
    const a = queued('m1');
    const b = queued('m1');
    queue.add(b);
    queue.add(a);

    // A fresh queue over the same storage sees them, as after a reload.
    const reloaded = new BrewQueue(store, async (body) => {
      sent.push(body.id);
      return { id: body.id } as BrewRow;
    });
    expect(reloaded.all()).toHaveLength(2);
    expect(await reloaded.sync('m1')).toEqual({ sent: 2, refused: 0, stopped: null });
    expect(sent).toEqual([a.id, b.id]);
    expect(reloaded.all()).toEqual([]);
    expect(store.data.size).toBe(0);
  });

  it('only sends the signed-in member’s brews', async () => {
    const sent: string[] = [];
    const queue = new BrewQueue(memoryStore(), async (body) => {
      sent.push(body.id);
      return {} as BrewRow;
    });
    const mine = queued('m1');
    const theirs = queued('m2');
    queue.add(mine);
    queue.add(theirs);
    await queue.sync('m1');
    expect(sent).toEqual([mine.id]);
    expect(queue.all().map((q) => q.id)).toEqual([theirs.id]);
  });

  it('stops and keeps everything while offline', async () => {
    const queue = new BrewQueue(memoryStore(), async () => {
      throw fail(0, 'offline');
    });
    queue.add(queued('m1'));
    queue.add(queued('m1'));
    expect(await queue.sync('m1')).toEqual({ sent: 0, refused: 0, stopped: 'offline' });
    expect(queue.all()).toHaveLength(2);
  });

  it('treats unknown failures as offline', async () => {
    const queue = new BrewQueue(memoryStore(), async () => {
      throw new TypeError('Failed to fetch');
    });
    queue.add(queued('m1'));
    expect((await queue.sync('m1')).stopped).toBe('offline');
    expect(queue.all()).toHaveLength(1);
  });

  it('waits for sign-in when the session has expired, and for the server when it errors', async () => {
    const signedOut = new BrewQueue(memoryStore(), async () => {
      throw fail(401, 'not_signed_in');
    });
    signedOut.add(queued('m1'));
    expect((await signedOut.sync('m1')).stopped).toBe('signed_out');
    expect(signedOut.all()).toHaveLength(1);

    const broken = new BrewQueue(memoryStore(), async () => {
      throw fail(500, 'server_error');
    });
    broken.add(queued('m1'));
    expect((await broken.sync('m1')).stopped).toBe('server');
    expect(broken.all()[0]?.error).toBeUndefined();
  });

  it('keeps a refused brew with the reason and carries on with the rest', async () => {
    const refusedOne = queued('m1');
    const good = queued('m1');
    const queue = new BrewQueue(memoryStore(), async (body) => {
      if (body.id === refusedOne.id) throw fail(400, 'recipe_not_found', 'That recipe no longer exists.');
      return {} as BrewRow;
    });
    queue.add(refusedOne);
    queue.add(good);
    expect(await queue.sync('m1')).toEqual({ sent: 1, refused: 1, stopped: null });
    expect(queue.all()).toEqual([{ ...refusedOne, error: 'That recipe no longer exists.' }]);

    // Refused brews aren't retried automatically; the member discards them.
    expect(await queue.sync('m1')).toEqual({ sent: 0, refused: 0, stopped: null });
    queue.remove(refusedOne.id);
    expect(queue.all()).toEqual([]);
  });

  it('runs one sync at a time', async () => {
    let calls = 0;
    const queue = new BrewQueue(memoryStore(), async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return {} as BrewRow;
    });
    queue.add(queued('m1'));
    const [first, second] = await Promise.all([queue.sync('m1'), queue.sync('m1')]);
    expect(calls).toBe(1);
    expect(first).toBe(second);
  });

  it('tells listeners when the queue changes', () => {
    const queue = new BrewQueue(memoryStore(), async () => ({}) as BrewRow);
    let changes = 0;
    const stop = queue.subscribe(() => changes++);
    queue.add(queued('m1'));
    stop();
    queue.add(queued('m1'));
    expect(changes).toBe(1);
  });
});
