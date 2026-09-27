import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import type { DuelView, RecipeRow } from '../../../shared/types';
import { errorMessage } from '../api';
import { FormError } from '../components/Fields';
import { TopBar } from '../components/TopBar';
import { formatDate } from '../format';
import { duelsQuery, recipesQuery } from '../queries';
import { strings } from '../strings';

const d = strings.duel;
const r = strings.recipes;

/** /duel: running duels, the leaderboard and recent results. Refreshes while open so judges see new duels. */
export function DuelsScreen() {
  const duels = useQuery({ ...duelsQuery, refetchInterval: 4000 });
  const recipes = useQuery(recipesQuery('all', null));
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

function ActiveRow({ duel }: { duel: DuelView }) {
  const judgeTurn = duel.you.is_judge && duel.status === 'judging' && !duel.you.vote;
  const title = judgeTurn
    ? d.judgeNow
    : duel.you.is_creator
      ? d.youPour
      : duel.you.is_judge && duel.status === 'pouring'
        ? d.waitingForCups
        : d.inProgress;
  const sub = [duel.bean ? d.on(duel.bean.name) : null, d.judgesLine(duel.judges.map((j) => j.name).join(', '))]
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
  const x = duel.x?.display_code ?? d.voteX;
  const y = duel.y?.display_code ?? d.voteY;
  let title: string = d.cancelled;
  let score = '';
  if (duel.status === 'revealed' && duel.result) {
    const { winner, x_votes, y_votes } = duel.result;
    title = winner === null ? d.drew(x, y) : winner === 'x' ? d.beat(x, y) : d.beat(y, x);
    score = winner === 'y' ? d.score(y_votes, x_votes) : d.score(x_votes, y_votes);
  }
  const sub = [formatDate(duel.revealed_at ?? duel.created_at), duel.bean?.name].filter(Boolean).join(' · ');
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
