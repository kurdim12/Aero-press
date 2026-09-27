import { useEffect, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import type { BeanTips, RecipeTips, TipsResponse, TipsSubject } from '../../../shared/types';
import { api, errorMessage } from '../api';
import { formatDate } from '../format';
import { useOnline } from '../offline/useOnline';
import { beansQuery, recipesQuery } from '../queries';
import { strings } from '../strings';
import { ExperimentCard } from './ExperimentCard';
import { FormError } from './Fields';

const t = strings.tips;
const POLL_MS = 3000;

/** One automatic attempt per bean or recipe per app session; after a failure it waits for a tap. */
const autoTried = new Set<string>();

const tipsPath = (subject: TipsSubject, id: string) =>
  `/api/${subject === 'bean' ? 'beans' : 'recipes'}/${encodeURIComponent(id)}/tips`;

/**
 * The coach's tips on a bean or recipe. While it's new, the first phone to open it asks for them
 * on its own (if the owner leaves that on); a second phone sees them being written and waits.
 */
function useTips<T>(subject: TipsSubject, id: string) {
  const qc = useQueryClient();
  const online = useOnline();
  const queryKey = ['tips', subject, id];
  const state = useQuery({
    queryKey,
    queryFn: () => api<TipsResponse<T>>('GET', tipsPath(subject, id)),
    refetchInterval: (q) => (q.state.data?.pending ? POLL_MS : false),
    enabled: online,
  });
  const write = useMutation({
    mutationFn: (refresh: boolean) => api<TipsResponse<T>>('POST', tipsPath(subject, id), { refresh }),
    onSuccess: (res) => {
      qc.setQueryData(queryKey, res);
      void qc.invalidateQueries({ queryKey: ['ai-usage'] });
    },
  });
  const { mutate } = write;
  const auto = state.data?.auto === true;
  useEffect(() => {
    const key = `${subject}:${id}`;
    if (!auto || !online || autoTried.has(key)) return;
    autoTried.add(key);
    mutate(false);
  }, [auto, online, subject, id, mutate]);
  return { state, write, online };
}

interface Labels {
  title: string;
  loading: string;
  get: string;
  stale: string;
}

function TipsSection<T>({ subject, id, labels, render }: { subject: TipsSubject; id: string; labels: Labels; render: (tips: T) => ReactNode }) {
  const { state, write, online } = useTips<T>(subject, id);
  const data = state.data;
  const writing = write.isPending || data?.pending === true;
  const askHref = `/coach?about=${subject}:${encodeURIComponent(id)}`;

  let body: ReactNode;
  if (!data) {
    if (!online) body = <p className="muted">{t.offline}</p>;
    else if (state.isError) body = <FormError>{errorMessage(state.error)}</FormError>;
    else return null;
  } else if (!data.configured) {
    body = <p className="muted">{t.notConfigured}</p>;
  } else if (data.tips) {
    body = (
      <>
        {render(data.tips)}
        <p className="muted small">
          {data.at !== null && t.written(formatDate(data.at))}
          {data.stale && ` · ${labels.stale}`}
        </p>
        {write.isError && <FormError>{errorMessage(write.error)}</FormError>}
        <div className="action-row">
          <button type="button" className="btn secondary" disabled={!online || writing} onClick={() => write.mutate(true)}>
            {writing ? t.updating : t.update}
          </button>
          <Link href={askHref} className="btn secondary">
            {t.askAbout}
          </Link>
        </div>
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
        <button type="button" className="btn secondary block" disabled={!online} onClick={() => write.mutate(false)}>
          {write.isError ? strings.common.retry : labels.get}
        </button>
        <p className="field-hint">{t.getHint}</p>
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

/** The coach's review of a recipe: verdict, tips, checks, and a next test to clone. */
export function RecipeCoachTips({ recipeId }: { recipeId: string }) {
  const recipes = useQuery(recipesQuery('all', null)).data?.recipes ?? [];
  const beans = useQuery(beansQuery).data?.beans ?? [];
  return (
    <TipsSection<RecipeTips>
      subject="recipe"
      id={recipeId}
      labels={{ title: t.recipeTitle, loading: t.loadingRecipe, get: t.getRecipe, stale: t.staleRecipe }}
      render={(tips) => (
        <>
          <div className="coach-card">
            <p className="coach-read">{tips.verdict}</p>
          </div>
          <ol className="tip-list">
            {tips.tips.map((tip, i) => (
              <li key={i}>
                <strong>{tip.title}</strong>
                <span>{tip.detail}</span>
              </li>
            ))}
          </ol>
          {tips.checks.length > 0 && (
            <>
              <h3 className="subhead">{t.checks}</h3>
              <ul className="fixes">
                {tips.checks.map((check, i) => (
                  <li key={i}>{check}</li>
                ))}
              </ul>
            </>
          )}
          {tips.next_test && (
            <>
              <h3 className="subhead">{t.nextTest}</h3>
              <ExperimentCard experiment={tips.next_test} recipes={recipes} beans={beans} action={strings.coach.createThis} />
            </>
          )}
        </>
      )}
    />
  );
}

/** The coach's first look at a coffee: what to expect, tips, and a starting recipe. */
export function BeanCoachTips({ beanId }: { beanId: string }) {
  const recipes = useQuery(recipesQuery('all', null)).data?.recipes ?? [];
  const beans = useQuery(beansQuery).data?.beans ?? [];
  return (
    <TipsSection<BeanTips>
      subject="bean"
      id={beanId}
      labels={{ title: t.beanTitle, loading: t.loadingBean, get: t.getBean, stale: t.staleBean }}
      render={(tips) => (
        <>
          <div className="coach-card">
            <p className="coach-read">{tips.summary}</p>
          </div>
          <ol className="tip-list">
            {tips.tips.map((tip, i) => (
              <li key={i}>
                <span>{tip}</span>
              </li>
            ))}
          </ol>
          {tips.start && (
            <>
              <h3 className="subhead">{t.start}</h3>
              <ExperimentCard experiment={tips.start} recipes={recipes} beans={beans} />
            </>
          )}
        </>
      )}
    />
  );
}
