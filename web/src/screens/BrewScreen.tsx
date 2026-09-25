import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import type { RecipeRow } from '../../../shared/types';
import { WINDOW_S, planBrew } from '../../../shared/phases';
import { PendingBrews } from '../brew/PendingBrews';
import { elapsedMs, useNow, useTimer } from '../brew/timer';
import { FormError } from '../components/Fields';
import { TopBar } from '../components/TopBar';
import { errorMessage } from '../api';
import { useFlash } from '../flash';
import { formatSeconds } from '../format';
import { lastBrewedRecipeId } from '../brew/lastBrewed';
import { useQueuedBrews } from '../offline/brewSync';
import { useOnline } from '../offline/useOnline';
import { recipesQuery } from '../queries';
import { useMe } from '../session';
import { strings } from '../strings';

const b = strings.brew;
const s = strings.recipes;

/** /brew: pick a recipe. The competition recipe and the last one brewed here come first. */
export function BrewScreen() {
  const recipes = useQuery(recipesQuery('all', null));
  const timer = useTimer();
  const now = useNow(timer.status === 'running', 500);
  const me = useMe();
  const online = useOnline();
  const flash = useFlash();
  // The waiting-brews box already says they sync later, so the general offline note steps aside.
  const waiting = useQueuedBrews(me.member.id).length > 0;

  const list = recipes.data?.recipes ?? [];
  const lastId = lastBrewedRecipeId();
  const last = list.find((r) => r.id === lastId);
  const ordered = [...list].sort((x, y) => Number(y.locked) - Number(x.locked));
  const running = timer.status !== 'idle' ? list.find((r) => r.id === timer.recipeId) : undefined;

  return (
    <>
      <TopBar title={b.title} />
      <main className="page shell-main">
        <div className="btn-stack" style={{ marginTop: 8 }}>
          {flash && (
            <p className="notice" role="status">
              {flash}
            </p>
          )}
          {!online && !waiting && <p className="notice">{b.offlineNote}</p>}
          {running && (
            <Link href={`/brew/${running.id}`} className="banner" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span style={{ flex: 1 }}>
                {b.inProgress(running.display_code, formatSeconds(Math.floor(elapsedMs(timer, now) / 1000)))}
                <span className="row-sub">{b.backToTimer}</span>
              </span>
            </Link>
          )}
          <PendingBrews />
        </div>

        {recipes.isError && !recipes.data && (
          <div className="section">
            <FormError>{errorMessage(recipes.error)}</FormError>
          </div>
        )}
        {recipes.isPending && (
          <div className="center-block">
            <div className="spinner" role="status" aria-label={strings.app.loading} />
          </div>
        )}

        {last && (
          <section className="section">
            <span className="eyebrow">{b.lastBrewed}</span>
            <ul className="rows">
              <PickRow recipe={last} />
            </ul>
          </section>
        )}
        {recipes.data &&
          (list.length === 0 ? (
            <section className="empty">
              <h2>{s.emptyTitle}</h2>
              <p>{s.emptyBody}</p>
            </section>
          ) : (
            <section className="section">
              <span className="eyebrow">{b.pick}</span>
              <ul className="rows">
                {ordered.map((r) => (
                  <PickRow key={r.id} recipe={r} />
                ))}
              </ul>
            </section>
          ))}
      </main>
    </>
  );
}

function PickRow({ recipe: r }: { recipe: RecipeRow }) {
  const plan = planBrew(r);
  const complete = plan.missing.length === 0;
  return (
    <li>
      <Link href={`/brew/${r.id}`} className="row">
        <span className="row-main">
          <span className="row-title">
            <span className="code">{r.display_code}</span>
            {r.name ?? s.untitled}
            {r.locked && <span className="tag gold">{s.compTag}</span>}
          </span>
          {r.bean_name && <span className="row-sub">{r.bean_name}</span>}
        </span>
        <span className="stat-cell">
          {complete ? (
            <>
              <span className={`stat-num condensed${plan.fits ? '' : ' warn'}`}>{formatSeconds(plan.total)}</span>
              <span className="stat-label">{plan.fits ? b.fits : b.over(formatSeconds(plan.total - WINDOW_S))}</span>
            </>
          ) : (
            <span className="stat-label">—</span>
          )}
        </span>
      </Link>
    </li>
  );
}
