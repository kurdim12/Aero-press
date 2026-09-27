import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import type { DuelChoice, DuelReadResponse, DuelRecipe, DuelView } from '../../../shared/types';
import { aiUsageQuery } from '../ai';
import { ApiError, api, errorMessage } from '../api';
import { ExperimentCard } from '../components/ExperimentCard';
import { FormError } from '../components/Fields';
import { TopBar } from '../components/TopBar';
import { useOnline } from '../offline/useOnline';
import { beansQuery, duelQuery, invalidateLibrary, isDuelFinished, recipesQuery } from '../queries';
import { strings } from '../strings';

const d = strings.duel;
const c = strings.coach;
const POLL_MS = 2000;
/** The coach reads a duel by itself for a day after the reveal; older duels get a button, to spare the budget. */
const READ_AUTO_MS = 24 * 3600_000;
/** Another phone is writing the read: ask again this often. */
const READ_POLL_MS = 3000;

/** /duel/:id — one duel, live on every phone: polls every 2 s until the reveal or a cancel. */
export function DuelScreen({ id }: { id: string }) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const online = useOnline();
  const duel = useQuery({
    ...duelQuery(id),
    refetchInterval: (q) => (q.state.data && isDuelFinished(q.state.data) ? false : POLL_MS),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The reveal changes Elo: refresh what shows it.
  const status = duel.data?.status;
  const previous = useRef(status);
  useEffect(() => {
    if (previous.current && previous.current !== status && (status === 'revealed' || status === 'cancelled')) {
      void invalidateLibrary(qc);
      void qc.invalidateQueries({ queryKey: ['duels'] });
    }
    previous.current = status;
  }, [status, qc]);

  const act = async (path: string, body?: { choice: DuelChoice }) => {
    setBusy(true);
    setError(null);
    try {
      const view = await api<DuelView>('POST', `/api/duels/${encodeURIComponent(id)}/${path}`, body ?? {});
      qc.setQueryData(['duel', view.id], view);
      if (view.id !== id) navigate(`/duel/${view.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const view = duel.data;
  return (
    <>
      <TopBar title={d.title} backHref="/duel" />
      <main className="page shell-main">
        {!online && <p className="notice" style={{ marginTop: 8 }}>{d.offline}</p>}
        {!view ? (
          duel.isError ? (
            <div className="section">
              <FormError>{errorMessage(duel.error)}</FormError>
            </div>
          ) : (
            <div className="center-block">
              <div className="spinner" role="status" aria-label={strings.app.loading} />
            </div>
          )
        ) : (
          <>
            <DuelHeader view={view} />
            {view.status === 'revealed' ? (
              <>
                <Reveal view={view} busy={busy} onRematch={() => void act('rematch')} />
                <DuelRead view={view} />
              </>
            ) : view.status === 'cancelled' ? (
              <p className="notice" style={{ marginTop: 16 }}>
                {d.cancelledBody}
              </p>
            ) : view.you.is_judge ? (
              <JudgePanel view={view} busy={busy} onVote={(choice) => void act('vote', { choice })} />
            ) : view.you.is_creator ? (
              <HelperPanel view={view} busy={busy} onReady={() => void act('ready')} onReveal={() => void act('reveal')} />
            ) : (
              <p className="notice" style={{ marginTop: 16 }}>
                {d.onlooker}
              </p>
            )}
            {error && (
              <div style={{ marginTop: 12 }}>
                <FormError>{error}</FormError>
              </div>
            )}
            {view.you.can_manage && !isDuelFinished(view) && <CancelButton busy={busy} onCancel={() => void act('cancel')} />}
            {isDuelFinished(view) && (
              <div className="section">
                <Link href="/duel" className="btn secondary block">
                  {d.backToDuels}
                </Link>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}

function DuelHeader({ view }: { view: DuelView }) {
  return (
    <div className="duel-head">
      {view.rematch_of && <span className="tag accent">{d.rematchOf}</span>}
      {view.bean && <p className="row-sub">{d.on(view.bean.name)}</p>}
      <ul className="judge-chips" aria-label={d.judges}>
        {view.judges.map((j) => (
          <li key={j.id} className={j.voted ? 'voted' : undefined}>
            <span className="avatar small">{j.initials}</span>
            {j.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecipeLine({ recipe }: { recipe: DuelRecipe | null }) {
  if (!recipe) return null;
  return (
    <Link href={`/recipes/${recipe.id}`} className="cup-recipe">
      <span className="code">{recipe.display_code}</span>
      {recipe.name ?? strings.recipes.untitled}
    </Link>
  );
}

function HelperPanel({
  view,
  busy,
  onReady,
  onReveal,
}: {
  view: DuelView;
  busy: boolean;
  onReady: () => void;
  onReveal: () => void;
}) {
  const pouring = view.status === 'pouring' || view.status === 'setup';
  return (
    <section className="duel-card helper-card">
      <span className="tag gold">{d.helperOnly}</span>
      <div className="cup-assign">
        <div className="cup">
          <span className="cup-letter condensed">X</span>
          <RecipeLine recipe={view.x} />
        </div>
        <div className="cup">
          <span className="cup-letter condensed">Y</span>
          <RecipeLine recipe={view.y} />
        </div>
      </div>
      {pouring ? (
        <>
          <p className="phase-detail">{d.markCups}</p>
          <button type="button" className="btn huge block" onClick={onReady} disabled={busy}>
            {d.cupsReady}
          </button>
        </>
      ) : (
        <>
          <p>{d.helperJudging}</p>
          <p className="duel-count condensed">{d.votesIn(view.votes_in, view.judges.length)}</p>
          {view.votes_in > 0 && view.votes_in < view.judges.length && (
            <button type="button" className="btn secondary block" onClick={onReveal} disabled={busy}>
              {d.revealNow(view.votes_in)}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function JudgePanel({ view, busy, onVote }: { view: DuelView; busy: boolean; onVote: (choice: DuelChoice) => void }) {
  if (view.status === 'pouring' || view.status === 'setup') {
    return (
      <section className="duel-card">
        <h2 className="phase-title condensed">{d.waitingTitle}</h2>
        <p>{d.waitingBody}</p>
      </section>
    );
  }
  if (view.you.vote) {
    return (
      <section className="duel-card">
        <h2 className="phase-title condensed">{d.youVoted(d.voteLabel[view.you.vote] ?? view.you.vote)}</h2>
        <p>{d.waitingVotes(view.votes_in, view.judges.length)}</p>
      </section>
    );
  }
  return (
    <section className="vote">
      <h2 className="phase-title condensed">{d.judgeTitle}</h2>
      <p className="phase-detail">{d.judgeBody}</p>
      <div className="vote-grid">
        <button type="button" className="btn vote-btn condensed" onClick={() => onVote('x')} disabled={busy}>
          {d.voteX}
        </button>
        <button type="button" className="btn vote-btn condensed" onClick={() => onVote('y')} disabled={busy}>
          {d.voteY}
        </button>
      </div>
      <button type="button" className="btn secondary huge block" onClick={() => onVote('tie')} disabled={busy}>
        {d.voteTie}
      </button>
    </section>
  );
}

function Reveal({ view, busy, onRematch }: { view: DuelView; busy: boolean; onRematch: () => void }) {
  const result = view.result;
  if (!result) return null;
  const winner = result.winner === 'x' ? view.x : result.winner === 'y' ? view.y : null;
  return (
    <section className="duel-card reveal">
      <h2 className={`result-title condensed${winner ? ' gold' : ''}`}>
        {winner ? d.wins(winner.display_code) : d.draw}
      </h2>
      <p className="duel-count condensed">{d.votesLine(result.x_votes, result.y_votes, result.ties)}</p>
      <div className="cup-assign">
        <div className={`cup${result.winner === 'x' ? ' winner' : ''}`}>
          <span className="cup-letter condensed">X</span>
          <RecipeLine recipe={view.x} />
        </div>
        <div className={`cup${result.winner === 'y' ? ' winner' : ''}`}>
          <span className="cup-letter condensed">Y</span>
          <RecipeLine recipe={view.y} />
        </div>
      </div>
      <div>
        <span className="eyebrow">{d.votes}</span>
        <dl className="kv-list">
          {view.judges.map((j) => (
            <div key={j.id} className="kv">
              <dt>{j.name}</dt>
              <dd>{j.choice ? (d.voteLabel[j.choice] ?? j.choice) : strings.common.none}</dd>
            </div>
          ))}
        </dl>
      </div>
      {view.notes && <p className="muted">{view.notes}</p>}
      {view.rematch_id ? (
        <Link href={`/duel/${view.rematch_id}`} className="btn block">
          {d.openRematch}
        </Link>
      ) : (
        view.you.can_manage && (
          <>
            <button type="button" className="btn block" onClick={onRematch} disabled={busy}>
              {d.rematch}
            </button>
            <p className="field-hint">{d.rematchHint}</p>
          </>
        )
      )}
    </section>
  );
}

/** The coach's read of a revealed duel and the next test it suggests. The first phone to ask writes it. */
function DuelRead({ view }: { view: DuelView }) {
  const qc = useQueryClient();
  const online = useOnline();
  const usage = useQuery(aiUsageQuery);
  const recipes = useQuery(recipesQuery('all', null)).data?.recipes ?? [];
  const beans = useQuery(beansQuery).data?.beans ?? [];
  const fresh = view.revealed_at !== null && Date.now() - view.revealed_at < READ_AUTO_MS;
  const [asked, setAsked] = useState(fresh);
  const read = useQuery({
    queryKey: ['duel-read', view.id],
    queryFn: async () => {
      const res = await api<DuelReadResponse>('POST', `/api/duels/${encodeURIComponent(view.id)}/read`, {});
      if (res.read) {
        qc.setQueryData<DuelView>(['duel', view.id], (old) => (old ? { ...old, ai_read: res.read } : old));
        void qc.invalidateQueries({ queryKey: ['ai-usage'] });
      }
      return res;
    },
    enabled: asked && online && !view.ai_read && usage.data?.configured !== false,
    refetchInterval: (q) => (q.state.data?.pending ? READ_POLL_MS : false),
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Infinity,
  });

  const result = view.ai_read ?? read.data?.read ?? null;
  if (!result && usage.data?.configured === false) return null;
  if (read.error instanceof ApiError && read.error.code === 'ai_not_configured') return null;
  return (
    <section className="section">
      <span className="eyebrow">{c.duelRead}</span>
      {result ? (
        <>
          <div className="coach-card">
            <p className="coach-read">{result.read}</p>
          </div>
          {result.next_test && (
            <>
              <h3 className="subhead">{c.nextTest}</h3>
              <ExperimentCard experiment={result.next_test} recipes={recipes} beans={beans} action={c.createThis} />
            </>
          )}
        </>
      ) : read.isError ? (
        <div className="btn-stack">
          <FormError>{errorMessage(read.error)}</FormError>
          <button type="button" className="btn secondary block" onClick={() => void read.refetch()}>
            {strings.common.retry}
          </button>
        </div>
      ) : !asked ? (
        <button type="button" className="btn secondary block" disabled={!online} onClick={() => setAsked(true)}>
          {c.readDuel}
        </button>
      ) : online ? (
        <p className="muted">{c.duelReadLoading}</p>
      ) : null}
    </section>
  );
}

/** Two taps, so a stray touch mid-judging doesn't throw the duel away. */
function CancelButton({ busy, onCancel }: { busy: boolean; onCancel: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);
  return (
    <div className="section">
      <button
        type="button"
        className={`btn ${armed ? 'danger' : 'ghost'} block`}
        disabled={busy}
        onClick={() => (armed ? onCancel() : setArmed(true))}
      >
        {armed ? d.cancelAgain : d.cancelDuel}
      </button>
    </div>
  );
}
