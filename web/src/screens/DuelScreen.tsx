import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import {
  type Criterion,
  type CupScores,
  type DuelChoice,
  type DuelPerson,
  type DuelReadResponse,
  type DuelRecipe,
  type DuelView,
  JUDGING_CRITERIA,
} from '../../../shared/types';
import type { DuelVoteInput } from '../../../shared/schemas';
import { aiUsageQuery } from '../ai';
import { ApiError, api, errorMessage } from '../api';
import { ExperimentCard } from '../components/ExperimentCard';
import { FormError } from '../components/Fields';
import { ScoreSlider } from '../components/ScoreSlider';
import { TopBar } from '../components/TopBar';
import { formatNumber } from '../format';
import { browserStore, readJson, writeJson } from '../offline/storage';
import { useOnline } from '../offline/useOnline';
import { beansQuery, duelQuery, invalidateLibrary, isDuelFinished, recipesQuery } from '../queries';
import { useMe } from '../session';
import { strings } from '../strings';

const d = strings.duel;
const c = strings.coach;
const LABELS = strings.brew.log.scoreLabels as Record<Criterion, string>;
const POLL_MS = 2000;
/** The coach reads a duel by itself for a day after the reveal; older duels get a button, to spare the budget. */
const READ_AUTO_MS = 24 * 3600_000;
/** Another phone is writing the read: ask again this often. */
const READ_POLL_MS = 3000;

type Sheet = Record<'x' | 'y', Partial<CupScores>>;
type FullSheet = Record<'x' | 'y', CupScores>;

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

  // The reveal changes Elo and the barista ranking: refresh what shows them.
  const status = duel.data?.status;
  const previous = useRef(status);
  useEffect(() => {
    if (previous.current && previous.current !== status && (status === 'revealed' || status === 'cancelled')) {
      void invalidateLibrary(qc);
      void qc.invalidateQueries({ queryKey: ['duels'] });
      void qc.invalidateQueries({ queryKey: ['barista-standings'] });
    }
    previous.current = status;
  }, [status, qc]);

  const act = async (path: string, body?: DuelVoteInput): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const view = await api<DuelView>('POST', `/api/duels/${encodeURIComponent(id)}/${path}`, body ?? {});
      qc.setQueryData(['duel', view.id], view);
      if (view.id !== id) navigate(`/duel/${view.id}`);
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
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
              <JudgePanel view={view} busy={busy} onVote={(choice, scores) => act('vote', { choice, scores })} />
            ) : view.you.is_creator ? (
              <HostPanel view={view} busy={busy} onReady={() => void act('ready')} onReveal={() => void act('reveal')} />
            ) : view.you.is_barista ? (
              <CompetitorPanel view={view} />
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
  const [a, b] = view.baristas ?? [];
  return (
    <div className="duel-head">
      {view.rematch_of && <span className="tag accent">{d.rematchOf}</span>}
      {a && b && (
        <p className="duel-matchup condensed">
          <span className="tag gold">{d.kinds.baristas}</span> {d.versus(a.name, b.name)}
        </p>
      )}
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

/** One cup: its letter, who brewed it (barista duels) and its recipe, when this phone may know. */
function Cup({ letter, barista, recipe, winner = false }: { letter: string; barista: DuelPerson | null; recipe: DuelRecipe | null; winner?: boolean }) {
  return (
    <div className={`cup${winner ? ' winner' : ''}`}>
      <span className="cup-letter condensed">{letter}</span>
      {barista && <span className="cup-barista">{barista.name}</span>}
      <RecipeLine recipe={recipe} />
    </div>
  );
}

/** The one who pours both cups (recipe duel) or places the baristas' cups (barista duel). */
function HostPanel({
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
  const baristaDuel = view.kind === 'baristas';
  return (
    <section className="duel-card helper-card">
      <span className="tag gold">{baristaDuel ? d.hostOnly : d.helperOnly}</span>
      <div className="cup-assign">
        <Cup letter="X" barista={view.x_barista} recipe={view.x} />
        <Cup letter="Y" barista={view.y_barista} recipe={view.y} />
      </div>
      {view.you.is_barista && view.you.my_recipe && pouring && (
        <Link href={`/brew/${view.you.my_recipe.id}`} className="btn secondary block">
          {d.openTimer}
        </Link>
      )}
      {pouring ? (
        <>
          <p className="phase-detail">{baristaDuel ? d.placeCups : d.markCups}</p>
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

/** A barista in the duel: what to brew, against whom, and a way into the timer. */
function CompetitorPanel({ view }: { view: DuelView }) {
  const me = useMe();
  const rival = view.baristas?.find((p) => p.id !== me.member.id);
  const recipe = view.you.my_recipe;
  if (view.status === 'judging') {
    return (
      <section className="duel-card">
        <h2 className="phase-title condensed">{d.competingTitle}</h2>
        <p>{d.helperJudging}</p>
        <p className="duel-count condensed">{d.votesIn(view.votes_in, view.judges.length)}</p>
      </section>
    );
  }
  return (
    <section className="duel-card">
      <h2 className="phase-title condensed">{d.competingTitle}</h2>
      {recipe && rival && <p>{d.competingBody(recipe.display_code, rival.name)}</p>}
      {recipe && (
        <Link href={`/brew/${recipe.id}`} className="btn block">
          {d.openTimer}
        </Link>
      )}
    </section>
  );
}

const sheetKey = (duelId: string) => `ap-judge-sheet:${duelId}`;
const store = browserStore();

const sumOf = (cup: Partial<CupScores>) => JUDGING_CRITERIA.reduce((total, k) => total + (cup[k] ?? 0), 0);
const isFull = (sheet: Sheet): sheet is FullSheet => JUDGING_CRITERIA.every((k) => sheet.x[k] != null && sheet.y[k] != null);

/** Score both cups on every criterion, then point at the better one. The sheet survives a reload. */
function JudgePanel({
  view,
  busy,
  onVote,
}: {
  view: DuelView;
  busy: boolean;
  onVote: (choice: DuelChoice, scores: FullSheet) => Promise<boolean>;
}) {
  const [sheet, setSheet] = useState<Sheet>(() => readJson<Sheet>(store, sheetKey(view.id)) ?? { x: {}, y: {} });
  const set = (cup: 'x' | 'y', key: Criterion, value: number | null) =>
    setSheet((current) => {
      const next = { ...current, [cup]: { ...current[cup], [key]: value ?? undefined } };
      writeJson(store, sheetKey(view.id), next);
      return next;
    });

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
  const full = isFull(sheet);
  const [tx, ty] = [sumOf(sheet.x), sumOf(sheet.y)];
  const vote = async (choice: DuelChoice) => {
    if (!isFull(sheet)) return;
    if (await onVote(choice, sheet)) writeJson(store, sheetKey(view.id), null);
  };
  return (
    <section className="vote">
      <h2 className="phase-title condensed">{d.scoreTitle}</h2>
      <p className="phase-detail">{d.scoreBody}</p>
      {(['x', 'y'] as const).map((cup) => (
        <div key={cup} className="score-sheet">
          <h3 className="score-sheet-cup condensed">{d.scoreCup(cup.toUpperCase())}</h3>
          {JUDGING_CRITERIA.map((key) => (
            <ScoreSlider key={key} label={LABELS[key]} value={sheet[cup][key] ?? null} onChange={(value) => set(cup, key, value)} />
          ))}
        </div>
      ))}
      <h2 className="phase-title condensed">{d.pickWinner}</h2>
      <p className="phase-detail" role="status">
        {!full
          ? d.scoreFirst
          : tx === ty
            ? d.scoresLevel(formatNumber(tx, 1))
            : d.scoresFavour(tx > ty ? 'X' : 'Y', formatNumber(Math.max(tx, ty), 1), formatNumber(Math.min(tx, ty), 1))}
      </p>
      <div className="vote-grid">
        <button type="button" className="btn vote-btn condensed" onClick={() => void vote('x')} disabled={busy || !full}>
          {d.voteX}
        </button>
        <button type="button" className="btn vote-btn condensed" onClick={() => void vote('y')} disabled={busy || !full}>
          {d.voteY}
        </button>
      </div>
      <button type="button" className="btn secondary huge block" onClick={() => void vote('tie')} disabled={busy || !full}>
        {d.voteTie}
      </button>
    </section>
  );
}

function Reveal({ view, busy, onRematch }: { view: DuelView; busy: boolean; onRematch: () => void }) {
  const result = view.result;
  if (!result) return null;
  const side = result.winner;
  const winnerRecipe = side === 'x' ? view.x : side === 'y' ? view.y : null;
  const winnerBarista = side === 'x' ? view.x_barista : side === 'y' ? view.y_barista : null;
  const title = view.kind === 'baristas' ? (winnerBarista ? d.personWins(winnerBarista.name) : d.draw) : winnerRecipe ? d.wins(winnerRecipe.display_code) : d.draw;
  return (
    <section className="duel-card reveal">
      <h2 className={`result-title condensed${side ? ' gold' : ''}`}>{title}</h2>
      {view.kind === 'baristas' && winnerRecipe && <p className="row-sub">{d.withRecipe(winnerRecipe.display_code)}</p>}
      <p className="duel-count condensed">{d.votesLine(result.x_votes, result.y_votes, result.ties)}</p>
      <div className="cup-assign">
        <Cup letter="X" barista={view.x_barista} recipe={view.x} winner={side === 'x'} />
        <Cup letter="Y" barista={view.y_barista} recipe={view.y} winner={side === 'y'} />
      </div>
      {result.scores && <ScoreTable scores={result.scores} />}
      <div>
        <span className="eyebrow">{d.votes}</span>
        <dl className="kv-list">
          {view.judges.map((j) => {
            const choice = j.choice ? (d.voteLabel[j.choice] ?? j.choice) : strings.common.none;
            return (
              <div key={j.id} className="kv">
                <dt>{j.name}</dt>
                <dd>{j.scores ? d.judgeLine(choice, formatNumber(sumOf(j.scores.x), 1), formatNumber(sumOf(j.scores.y), 1)) : choice}</dd>
              </div>
            );
          })}
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

/** The judges' average per criterion for each cup; the higher of each pair stands out. */
function ScoreTable({ scores }: { scores: { x: CupScores; y: CupScores } }) {
  const rows: [string, number, number][] = [
    ...JUDGING_CRITERIA.map((k): [string, number, number] => [LABELS[k], scores.x[k], scores.y[k]]),
    [d.total, sumOf(scores.x), sumOf(scores.y)],
  ];
  return (
    <div>
      <span className="eyebrow">{d.scoresTitle}</span>
      <table className="score-table">
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">{d.scoresTitle}</span>
            </th>
            <th scope="col">X</th>
            <th scope="col">Y</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, x, y]) => (
            <tr key={label} className={label === d.total ? 'total' : undefined}>
              <th scope="row">{label}</th>
              <td className={x > y ? 'higher' : undefined}>{formatNumber(x, 1)}</td>
              <td className={y > x ? 'higher' : undefined}>{formatNumber(y, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="field-hint">{d.scoresHint}</p>
    </div>
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
