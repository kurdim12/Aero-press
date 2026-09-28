import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import type { BaristaStanding, DuelView, RecipeRow } from '../../../shared/types';
import { errorMessage } from '../api';
import { FormError } from '../components/Fields';
import { TopBar } from '../components/TopBar';
import { formatDate, formatNumber } from '../format';
import { baristaStandingsQuery, duelsQuery, recipesQuery } from '../queries';
import { strings } from '../strings';

const d = strings.duel;
const r = strings.recipes;

/**
 * /duel: running duels, the rankings (baristas and recipes) and recent results. The list refreshes
 * while open so judges see new duels; the rankings are read once.
 */
export function DuelsScreen() {
  const duels = useQuery({ ...duelsQuery, refetchInterval: 4000 });
  const recipes = useQuery(recipesQuery('all', null));
  const standings = useQuery(baristaStandingsQuery);
  const active = duels.data?.active ?? [];
  const recent = duels.data?.recent ?? [];

  return (
    <>
      <TopBar title={d.title} />
      <main className="page shell-main">
        {duels.isError && !duels.data && (
          <div className="section">
            <FormError>{errorMessage(duels.error)}</FormError>
          </div>
        )}
        {active.length > 0 && (
          <section className="section">
            <span className="eyebrow">{d.now}</span>
            <ul className="rows">
              {active.map((duel) => (
                <ActiveRow key={duel.id} duel={duel} />
              ))}
            </ul>
          </section>
        )}
        <div className="section">
          <Link href="/duel/new" className="btn block">
            {d.start}
          </Link>
        </div>

        <BaristaBoard standings={standings.data?.baristas} />
        <Leaderboard recipes={recipes.data?.recipes ?? []} />

        <section className="section">
          <span className="eyebrow">{d.results}</span>
          {duels.isPending ? (
            <div className="center-block">
              <div className="spinner" role="status" aria-label={strings.app.loading} />
            </div>
          ) : recent.length === 0 ? (
            <p className="muted">{d.noResults}</p>
          ) : (
            <ul className="rows">
              {recent.map((duel) => (
                <ResultRow key={duel.id} duel={duel} />
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}

const matchup = (duel: DuelView) => {
  const [a, b] = duel.baristas ?? [];
  return a && b ? d.versus(a.name, b.name) : null;
};

function ActiveRow({ duel }: { duel: DuelView }) {
  const judgeTurn = duel.you.is_judge && duel.status === 'judging' && !duel.you.vote;
  const title = judgeTurn
    ? d.judgeNow
    : duel.you.is_creator
      ? duel.kind === 'baristas'
        ? d.youHost
        : d.youPour
      : duel.you.is_barista
        ? d.youCompete
        : duel.you.is_judge && duel.status === 'pouring'
          ? d.waitingForCups
          : d.inProgress;
  const sub = [matchup(duel), duel.bean ? d.on(duel.bean.name) : null, d.judgesLine(duel.judges.map((j) => j.name).join(', '))]
    .filter(Boolean)
    .join(' · ');
  return (
    <li>
      <Link href={`/duel/${duel.id}`} className={`row${judgeTurn ? ' row-call' : ''}`}>
        <span className="row-main">
          <span className="row-title">{title}</span>
          <span className="row-sub">{sub}</span>
        </span>
        <span className="stat-cell">
          <span className="stat-num condensed">{duel.status === 'judging' ? `${duel.votes_in}/${duel.judges.length}` : '—'}</span>
          <span className="stat-label">{duel.status === 'judging' ? d.judging : d.pouring}</span>
        </span>
      </Link>
    </li>
  );
}

function ResultRow({ duel }: { duel: DuelView }) {
  // A barista duel is between people; a recipe duel between recipes.
  const x = duel.x_barista?.name ?? duel.x?.display_code ?? d.voteX;
  const y = duel.y_barista?.name ?? duel.y?.display_code ?? d.voteY;
  let title: string = d.cancelled;
  let score = '';
  if (duel.status === 'revealed' && duel.result) {
    const { winner, x_votes, y_votes } = duel.result;
    title = winner === null ? d.drew(x, y) : winner === 'x' ? d.beat(x, y) : d.beat(y, x);
    score = winner === 'y' ? d.score(y_votes, x_votes) : d.score(x_votes, y_votes);
  }
  const sub = [
    formatDate(duel.revealed_at ?? duel.created_at),
    duel.kind === 'baristas' ? (duel.status === 'revealed' ? d.kinds.baristas : matchup(duel)) : null,
    duel.bean?.name,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li>
      <Link href={`/duel/${duel.id}`} className="row">
        <span className="row-main">
          <span className="row-title">{title}</span>
          <span className="row-sub">{sub}</span>
        </span>
        {score && (
          <span className="stat-cell">
            <span className="stat-num condensed">{score}</span>
          </span>
        )}
      </Link>
    </li>
  );
}

/** Top recipes by Elo, and each member's best, from duels already revealed. */
function Leaderboard({ recipes }: { recipes: RecipeRow[] }) {
  const ranked = recipes.filter((x) => x.duels > 0);
  const best = new Map<string, RecipeRow>();
  for (const recipe of ranked) if (!best.has(recipe.owner_member_id)) best.set(recipe.owner_member_id, recipe);
  return (
    <section className="section">
      <span className="eyebrow">{d.leaderboard}</span>
      {ranked.length === 0 ? (
        <p className="muted">{d.noRanked}</p>
      ) : (
        <>
          <h3 className="subhead">{d.topRecipes}</h3>
          <ul className="rows">
            {ranked.slice(0, 5).map((recipe, i) => (
              <li key={recipe.id}>
                <Link href={`/recipes/${recipe.id}`} className="row">
                  <span className="rank condensed">{r.rank(i + 1)}</span>
                  <span className="row-main">
                    <span className="row-title">
                      <span className="code">{recipe.display_code}</span>
                      {recipe.name ?? r.untitled}
                    </span>
                    <span className="row-sub">{recipe.owner_name}</span>
                  </span>
                  <span className="stat-cell">
                    <span className={`stat-num condensed${i === 0 ? ' gold' : ''}`}>{recipe.elo}</span>
                    <span className="stat-label">{r.record(recipe)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <h3 className="subhead">{d.bestPerMember}</h3>
          <ul className="rows">
            {[...best.values()].map((recipe) => (
              <li key={recipe.owner_member_id}>
                <Link href={`/recipes/${recipe.id}`} className="row">
                  <span className="avatar small">{recipe.owner_initials}</span>
                  <span className="row-main">
                    <span className="row-title">{recipe.owner_name}</span>
                    <span className="row-sub">
                      {recipe.display_code} {recipe.name ?? ''}
                    </span>
                  </span>
                  <span className="stat-cell">
                    <span className="stat-num condensed">{recipe.elo}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** The baristas ranked by their barista duels: Elo, record and the judges' average overall score. */
function BaristaBoard({ standings }: { standings: BaristaStanding[] | undefined }) {
  if (!standings) return null;
  return (
    <section className="section">
      <span className="eyebrow">{d.baristas}</span>
      {standings.length === 0 ? (
        <p className="muted">{d.noBaristaDuels}</p>
      ) : (
        <ul className="rows">
          {standings.map((b, i) => (
            <li key={b.id}>
              <div className="row">
                <span className="rank condensed">{r.rank(i + 1)}</span>
                <span className="avatar small">{b.initials}</span>
                <span className="row-main">
                  <span className="row-title">{b.name}</span>
                  <span className="row-sub">{d.baristaSub(r.record(b), b.avg_overall === null ? null : formatNumber(b.avg_overall, 1))}</span>
                </span>
                <span className="stat-cell">
                  <span className={`stat-num condensed${i === 0 ? ' gold' : ''}`}>{b.elo}</span>
                  <span className="stat-label">{r.elo}</span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
