// The AI coach in the app: queries, the streamed answer reader, and "Create as new recipe".
import { queryOptions } from '@tanstack/react-query';
import { deltaText, isStreamError, parseDataLine } from '../../shared/aiStream';
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

  // Server-sent events from either provider (Anthropic or OpenRouter), read line by line. Only the
  // text deltas matter; comments, [DONE] and bookkeeping events add nothing.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  const take = (line: string) => {
    const event = parseDataLine(line.trim());
    if (!event) return;
    if (isStreamError(event)) throw new ApiError(503, 'ai_busy', strings.errors.byCode.ai_busy as string);
    const delta = deltaText(event);
    if (delta) {
      text += delta;
      onText(text);
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      take(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf('\n');
    }
  }
  take(buffer + decoder.decode());
}
