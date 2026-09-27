import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import type { BeanRow, ExperimentsResponse, ReadinessReport, RecipeRow, TodayResponse } from '../../../shared/types';
import { aiUsageQuery, readinessQuery, streamAnswer, todayQuery } from '../ai';
import { api, errorMessage } from '../api';
import { ExperimentCard } from '../components/ExperimentCard';
import { FormError, SelectField, TextAreaField, TextField } from '../components/Fields';
import { TopBar } from '../components/TopBar';
import { formatDate } from '../format';
import { useOnline } from '../offline/useOnline';
import { beansQuery, recipesQuery } from '../queries';
import { strings } from '../strings';

const c = strings.coach;

/** /coach: today's duels, plan, adapt, readiness and ask anything. Every call counts toward the AI budget. */
export function CoachScreen() {
  const online = useOnline();
  const usage = useQuery(aiUsageQuery);
  const recipes = useQuery(recipesQuery('all', null)).data?.recipes ?? [];
  const beans = useQuery(beansQuery).data?.beans ?? [];
  const configured = usage.data?.configured ?? true;
  const enabled = online && configured;

  return (
    <>
      <TopBar title={c.title} />
      <main className="page shell-main">
        {!online && <p className="notice" style={{ marginTop: 8 }}>{c.offline}</p>}
        {usage.data && !usage.data.configured && <p className="notice" style={{ marginTop: 8 }}>{c.notConfigured}</p>}
        {usage.data && usage.data.configured && (
          <p className="muted small" style={{ marginTop: 8 }}>
            {c.spend(c.money(usage.data.month_spend_usd), c.money(usage.data.cap_usd))}
          </p>
        )}
        <TodayCard enabled={enabled} />
        <PlanSection enabled={enabled} recipes={recipes} beans={beans} />
        <AdaptSection enabled={enabled} recipes={recipes} beans={beans} />
        <ReadinessSection enabled={enabled} />
        <AskSection enabled={enabled} />
      </main>
    </>
  );
}

function useSpendRefresh() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ['ai-usage'] });
}

/** Written once per member per day, the first time the card is shown. */
export function TodayCard({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const refreshSpend = useSpendRefresh();
  const today = useQuery(todayQuery);
  const write = useMutation({
    mutationFn: () => api<TodayResponse>('POST', '/api/coach/today'),
    onSuccess: (data) => qc.setQueryData(todayQuery.queryKey, data),
    onSettled: refreshSpend,
  });
  const asked = useRef(false);
  const { mutate } = write;
  useEffect(() => {
    if (enabled && today.data && today.data.session === null && !asked.current) {
      asked.current = true;
      mutate();
    }
  }, [enabled, today.data, mutate]);

  const session = today.data?.session;
  return (
    <section className="section">
      <span className="eyebrow">{c.today}</span>
      {session ? (
        <div className="coach-card">
          <p>{session.summary}</p>
          {session.duels.length > 0 ? (
            <ul className="rows">
              {session.duels.map((duel) => (
                <li key={`${duel.a}-${duel.b}`}>
                  <div className="row">
                    <span className="row-main">
                      <span className="row-title">{c.versus(duel.a, duel.b)}</span>
                      <span className="row-sub">{duel.why}</span>
                    </span>
                    {duel.a_id && duel.b_id && (
                      <Link href={`/duel/new?a=${encodeURIComponent(duel.a_id)}&b=${encodeURIComponent(duel.b_id)}`} className="btn compact secondary">
                        {c.startDuel}
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{c.todayEmpty}</p>
          )}
        </div>
      ) : write.isPending ? (
        <p className="muted">{c.todayLoading}</p>
      ) : write.isError ? (
        <FormError>{errorMessage(write.error)}</FormError>
      ) : today.isError ? (
        <FormError>{errorMessage(today.error)}</FormError>
      ) : null}
    </section>
  );
}

function Experiments({ result, recipes, beans }: { result: ExperimentsResponse; recipes: RecipeRow[]; beans: BeanRow[] }) {
  return (
    <div className="coach-result" aria-live="polite">
      <p className="coach-read">{result.read}</p>
      {result.experiments.map((e, i) => (
        <ExperimentCard key={`${i}-${e.title}`} experiment={e} recipes={recipes} beans={beans} />
      ))}
    </div>
  );
}

function PlanSection({ enabled, recipes, beans }: { enabled: boolean; recipes: RecipeRow[]; beans: BeanRow[] }) {
  const [focus, setFocus] = useState('');
  const refreshSpend = useSpendRefresh();
  const plan = useMutation({
    mutationFn: () => api<ExperimentsResponse>('POST', '/api/coach/plan', { focus: focus.trim() || null }),
    onSettled: refreshSpend,
  });
  return (
    <section className="section form">
      <span className="eyebrow">{c.plan}</span>
      <p className="field-hint">{c.planHint}</p>
      <TextField label={c.focus} placeholder={c.focusPlaceholder} value={focus} onChange={setFocus} maxLength={300} />
      <button type="button" className="btn block" disabled={!enabled || plan.isPending} onClick={() => plan.mutate()}>
        {plan.isPending ? c.thinkingShort : c.planButton}
      </button>
      {plan.isPending && <p className="field-hint">{c.thinking}</p>}
      {plan.isError && <FormError>{errorMessage(plan.error)}</FormError>}
      {plan.data && <Experiments result={plan.data} recipes={recipes} beans={beans} />}
    </section>
  );
}

function AdaptSection({ enabled, recipes, beans }: { enabled: boolean; recipes: RecipeRow[]; beans: BeanRow[] }) {
  const [beanId, setBeanId] = useState('');
  const [recipeId, setRecipeId] = useState('');
  const [missing, setMissing] = useState(false);
  const refreshSpend = useSpendRefresh();
  const adapt = useMutation({
    mutationFn: () => api<ExperimentsResponse>('POST', '/api/coach/adapt', { bean_id: beanId, recipe_id: recipeId }),
    onSettled: refreshSpend,
  });
  const go = () => {
    setMissing(!beanId || !recipeId);
    if (beanId && recipeId) adapt.mutate();
  };
  return (
    <section className="section form">
      <span className="eyebrow">{c.adapt}</span>
      <p className="field-hint">{c.adaptHint}</p>
      <SelectField
        label={c.adaptBean}
        value={beanId}
        onChange={setBeanId}
        options={[{ value: '', label: c.pickBean }, ...beans.map((b) => ({ value: b.id, label: b.name }))]}
      />
      <SelectField
        label={c.adaptRecipe}
        value={recipeId}
        onChange={setRecipeId}
        options={[{ value: '', label: c.pickRecipe }, ...recipes.map((r) => ({ value: r.id, label: `${r.display_code} ${r.name ?? ''}`.trim() }))]}
      />
      {missing && <p className="field-error">{c.needBeanAndRecipe}</p>}
      <button type="button" className="btn block" disabled={!enabled || adapt.isPending} onClick={go}>
        {adapt.isPending ? c.thinkingShort : c.adaptButton}
      </button>
      {adapt.isPending && <p className="field-hint">{c.thinking}</p>}
      {adapt.isError && <FormError>{errorMessage(adapt.error)}</FormError>}
      {adapt.data && <Experiments result={adapt.data} recipes={recipes} beans={beans} />}
    </section>
  );
}

export function ReadinessCard({ report }: { report: ReadinessReport }) {
  const tone = report.verdict === 'ready' ? 'accent' : report.verdict === 'close' ? 'gold' : 'warn';
  return (
    <div className="coach-card readiness">
      <span className={`tag ${tone}`}>{c.verdicts[report.verdict] ?? report.verdict}</span>
      <h3 className="subhead">{c.biggestRisk}</h3>
      <p>{report.biggestRisk}</p>
      <h3 className="subhead">{c.fixes}</h3>
      <ol className="fixes">
        {report.fixes.map((fix) => (
          <li key={fix}>{fix}</li>
        ))}
      </ol>
      <h3 className="subhead">{c.evidence}</h3>
      <p>{report.evidence}</p>
      <p className="muted small">{c.reportBy(report.member_name, formatDate(report.created_at))}</p>
    </div>
  );
}

function ReadinessSection({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const refreshSpend = useSpendRefresh();
  const latest = useQuery(readinessQuery);
  const write = useMutation({
    mutationFn: () => api<{ report: ReadinessReport }>('POST', '/api/coach/readiness'),
    onSuccess: (data) => qc.setQueryData(readinessQuery.queryKey, data),
    onSettled: refreshSpend,
  });
  const report = latest.data?.report;
  return (
    <section className="section">
      <span className="eyebrow">{c.readiness}</span>
      <p className="field-hint">{c.readinessHint}</p>
      {report ? <ReadinessCard report={report} /> : latest.data && <p className="muted">{c.noReport}</p>}
      <button type="button" className="btn secondary block" style={{ marginTop: 12 }} disabled={!enabled || write.isPending} onClick={() => write.mutate()}>
        {write.isPending ? c.thinkingShort : c.readinessButton}
      </button>
      {write.isPending && <p className="field-hint">{c.thinking}</p>}
      {write.isError && <FormError>{errorMessage(write.error)}</FormError>}
    </section>
  );
}

function AskSection({ enabled }: { enabled: boolean }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refreshSpend = useSpendRefresh();
  const ask = async () => {
    if (!question.trim()) {
      setError(c.askEmpty);
      return;
    }
    setBusy(true);
    setError(null);
    setAnswer('');
    try {
      await streamAnswer(question.trim(), setAnswer);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      refreshSpend();
    }
  };
  return (
    <section className="section form">
      <span className="eyebrow">{c.ask}</span>
      <TextAreaField label={c.question} placeholder={c.askPlaceholder} value={question} onChange={setQuestion} maxLength={1000} />
      <button type="button" className="btn block" disabled={!enabled || busy} onClick={() => void ask()}>
        {busy && !answer ? c.thinkingShort : c.askButton}
      </button>
      {error && <FormError>{error}</FormError>}
      {answer && (
        <div className="coach-card answer" aria-live="polite">
          {answer}
        </div>
      )}
    </section>
  );
}
