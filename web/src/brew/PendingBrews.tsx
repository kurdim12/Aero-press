import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { brewQueue, useQueuedBrews } from '../offline/brewSync';
import { useOnline } from '../offline/useOnline';
import { invalidateLibrary } from '../queries';
import { useMe } from '../session';
import { strings } from '../strings';

const b = strings.brew;

/** Brews waiting on this phone, with a way to sync now or drop one the server refused. */
export function PendingBrews() {
  const me = useMe();
  const qc = useQueryClient();
  const online = useOnline();
  const queued = useQueuedBrews(me.member.id);
  const [syncing, setSyncing] = useState(false);
  const waiting = queued.filter((q) => !q.error);
  const refused = queued.filter((q) => q.error);
  if (queued.length === 0) return null;

  const syncNow = async () => {
    setSyncing(true);
    const result = await brewQueue.sync(me.member.id);
    setSyncing(false);
    if (result.sent > 0) await invalidateLibrary(qc);
  };

  return (
    <section className="banner warn" style={{ display: 'grid', gap: 10 }} role="status">
      {waiting.length > 0 && (
        <>
          <strong>{b.waitingTitle(waiting.length)}</strong>
          <span style={{ fontWeight: 500 }}>{b.waitingBody(waiting.length)}</span>
          {online && (
            <button type="button" className="btn secondary" onClick={() => void syncNow()} disabled={syncing}>
              {b.syncNow}
            </button>
          )}
        </>
      )}
      {refused.map((q) => (
        <div key={q.id} style={{ display: 'grid', gap: 8 }}>
          <span>{b.refused(q.label, q.error ?? '')}</span>
          <button type="button" className="btn secondary" onClick={() => brewQueue.remove(q.id)}>
            {b.discard}
          </button>
        </div>
      ))}
    </section>
  );
}
