import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SavedRead } from '../../../shared/types';
import { api, errorMessage } from '../api';
import { formatDate } from '../format';
import { useOnline } from '../offline/useOnline';
import { strings } from '../strings';
import { FormError } from './Fields';

const POLL_MS = 3000;

/**
 * A coach explanation the team keeps: read what's there, write it on a tap, and wait (polling)
 * while another phone writes it.
 */
export function useSavedRead<T>(
  queryKey: readonly unknown[],
  path: string,
  write: (refresh: boolean, seen: number | null) => Promise<SavedRead<T>>,
) {
  const qc = useQueryClient();
  const online = useOnline();
  const state = useQuery({
    queryKey,
    queryFn: () => api<SavedRead<T>>('GET', path),
    refetchInterval: (q) => (q.state.data?.pending ? POLL_MS : false),
    enabled: online,
  });
  const mutation = useMutation({
    // `seen`: the one this phone shows, so "again" returns a newer one someone else just wrote.
    mutationFn: (refresh: boolean) => write(refresh, state.data?.at ?? null),
    onSuccess: (res) => {
      qc.setQueryData(queryKey, res);
      void qc.invalidateQueries({ queryKey: ['ai-usage'] });
    },
  });
  return { state, write: mutation, online };
}

export interface SavedReadLabels {
  title: string;
  button: string;
  hint: string;
  loading: string;
  again: string;
  stale: string;
}

export function SavedReadSection<T>({
  saved: { state, write, online },
  labels,
  render,
}: {
  saved: ReturnType<typeof useSavedRead<T>>;
  labels: SavedReadLabels;
  render: (read: T) => ReactNode;
}) {
  const data = state.data;
  const writing = write.isPending || data?.pending === true;

  let body: ReactNode;
  if (!data) {
    if (!online) body = <p className="muted">{strings.tips.offline}</p>;
    else if (state.isError) body = <FormError>{errorMessage(state.error)}</FormError>;
    else return null;
  } else if (!data.configured) {
    body = <p className="muted">{strings.tips.needsKey}</p>;
  } else if (data.read) {
    body = (
      <>
        {render(data.read)}
        <p className="muted small">
          {data.at !== null && strings.tips.written(formatDate(data.at))}
          {data.stale && ` · ${labels.stale}`}
        </p>
        {write.isError && <FormError>{errorMessage(write.error)}</FormError>}
        <button type="button" className="btn secondary block" disabled={!online || writing} onClick={() => write.mutate(true)}>
          {writing ? strings.tips.updating : labels.again}
        </button>
      </>
    );
  } else if (writing) {
    body = (
      <p className="muted tips-loading" role="status">
        {labels.loading}
      </p>
    );
  } else {
    body = (
      <div className="btn-stack">
        {write.isError && <FormError>{errorMessage(write.error)}</FormError>}
        <button type="button" className="btn block" disabled={!online} onClick={() => write.mutate(false)}>
          {write.isError ? strings.common.retry : labels.button}
        </button>
        <p className="field-hint">{labels.hint}</p>
      </div>
    );
  }

  return (
    <section className="section coach-tips">
      <span className="eyebrow">{labels.title}</span>
      {body}
    </section>
  );
}
