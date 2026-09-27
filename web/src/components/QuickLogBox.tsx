import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { QuickLogResponse } from '../../../shared/types';
import { api, errorMessage } from '../api';
import { useDictation } from '../dictation';
import { useOnline } from '../offline/useOnline';
import { strings } from '../strings';
import { FormError, TextAreaField } from './Fields';

const q = strings.quickLog;

/** How many brew fields a quick log filled. */
export function filledCount(r: QuickLogResponse): number {
  const keys = ['grind_used', 'total_time_s', 'tds_pct', 'beverage_g', 'sweetness', 'acidity', 'body', 'clarity', 'finish', 'overall', 'notes', 'bean_id'] as const;
  return keys.filter((k) => r[k] !== null && r[k] !== '').length;
}

/** Say or type the brew; the coach (Haiku) turns it into log fields for the barista to check. */
export function QuickLogBox({ recipeId, onResult }: { recipeId?: string; onResult: (result: QuickLogResponse) => void }) {
  const online = useOnline();
  const [text, setText] = useState('');
  const dictation = useDictation((spoken) => setText((current) => (current ? `${current} ${spoken}` : spoken)));
  const parse = useMutation({
    mutationFn: () => api<QuickLogResponse>('POST', '/api/coach/quick-log', { text, ...(recipeId ? { recipe_id: recipeId } : {}) }),
    onSuccess: onResult,
  });

  if (!online) return <p className="notice">{q.offline}</p>;
  return (
    <div className="quick-log">
      <p className="field-hint">{q.hint}</p>
      <TextAreaField label={q.label} placeholder={q.placeholder} value={text} onChange={setText} maxLength={1000} rows={3} />
      <div className="action-row">
        {dictation.available && (
          <button type="button" className={`btn secondary${dictation.listening ? ' listening' : ''}`} onClick={dictation.toggle} aria-pressed={dictation.listening}>
            {dictation.listening ? q.listening : q.mic}
          </button>
        )}
        <button type="button" className="btn" disabled={parse.isPending || !text.trim()} onClick={() => parse.mutate()}>
          {parse.isPending ? q.filling : q.fill}
        </button>
      </div>
      {parse.isError && <FormError>{errorMessage(parse.error)}</FormError>}
    </div>
  );
}
