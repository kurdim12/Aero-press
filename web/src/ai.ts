// The AI coach in the app: queries, the streamed answer reader, and "Create as new recipe".
import { queryOptions } from '@tanstack/react-query';
import type { AiUsage, Experiment, ReadinessReport, TodayResponse } from '../../shared/types';
import { ApiError, api, apiErrorFrom } from './api';
import { stashRecipeDraft } from './drafts';
import { strings } from './strings';

export const aiUsageQuery = queryOptions({
  queryKey: ['ai-usage'],
  queryFn: () => api<AiUsage>('GET', '/api/coach/usage'),
});

export const readinessQuery = queryOptions({
  queryKey: ['readiness'],
  queryFn: () => api<{ report: ReadinessReport | null }>('GET', '/api/coach/readiness'),
});

export const todayQuery = queryOptions({
  queryKey: ['coach-today'],
  queryFn: () => api<TodayResponse>('GET', '/api/coach/today'),
});

/** "Create as new recipe": the clone form (or a new recipe) prefilled with the experiment. */
export function experimentHref(e: Experiment): string {
  const key = stashRecipeDraft({
    changes: { ...e.changes, name: e.changes.name ?? e.title },
    note: strings.coach.draftNote(e.why, e.listenFor),
  });
  return e.parent_id ? `/recipes/new?from=${encodeURIComponent(e.parent_id)}&draft=${key}` : `/recipes/new?draft=${key}`;
}

/** Ask the coach and read the streamed answer; `onText` gets the answer so far. */
export async function streamAnswer(question: string, onText: (text: string) => void): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/coach/ask', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question }),
    });
  } catch {
    throw new ApiError(0, 'offline', strings.errors.offline);
  }
  if (!res.ok || !res.body) throw apiErrorFrom(res.status, await res.json().catch(() => null));

  // Server-sent events: blank-line separated, each with a "data:" JSON line. Only text deltas matter.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end = buffer.indexOf('\n\n');
    while (end >= 0) {
      const event = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      end = buffer.indexOf('\n\n');
      const line = event.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const data = JSON.parse(line.slice(6)) as { type?: string; delta?: { type?: string; text?: string } };
      if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta' && data.delta.text) {
        text += data.delta.text;
        onText(text);
      } else if (data.type === 'error') {
        throw new ApiError(503, 'ai_busy', strings.errors.byCode.ai_busy as string);
      }
    }
  }
}
