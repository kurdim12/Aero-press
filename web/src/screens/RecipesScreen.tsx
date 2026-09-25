import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearch } from 'wouter';
import type { RecipeRow } from '../../../shared/types';
import { errorMessage } from '../api';
import { FormError } from '../components/Fields';
import { TopBar } from '../components/TopBar';
import { formatRatio, formatTemp } from '../format';
import { beansQuery, recipesQuery, type RecipeScope } from '../queries';
import { useIsOwner } from '../session';
import { strings } from '../strings';

const s = strings.recipes;

export function RecipesScreen() {
  const isOwner = useIsOwner();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(useSearch());
  const scope: RecipeScope = params.get('scope') === 'mine' ? 'mine' : 'all';
  const beanId = params.get('bean') || null;

  const beans = useQuery(beansQuery);
  const recipes = useQuery(recipesQuery(scope, beanId));

  const setFilters = (next: { scope?: RecipeScope; bean?: string | null }) => {
    const q = new URLSearchParams();
    const nextScope = next.scope ?? scope;
    const nextBean = next.bean === undefined ? beanId : next.bean;
    if (nextScope === 'mine') q.set('scope', 'mine');
    if (nextBean) q.set('bean', nextBean);
    const qs = q.toString();
    navigate(`/recipes${qs ? `?${qs}` : ''}`, { replace: true });
  };

  const list = recipes.data?.recipes ?? [];
  const emptyText = beanId ? s.emptyBean : scope === 'mine' ? s.emptyMine : null;

  return (
    <>
      <TopBar
        title={s.title}
        actions={
          <Link href="/recipes/new" className="btn compact" aria-label={s.new}>
            {s.newShort}
          </Link>
        }
      />
      <main className="page shell-main">
        <div className="filters">
          <div className="segmented" role="group" aria-label={s.scopeLabel}>
            {(
              [
                ['all', s.everyone],
                ['mine', s.mine],
              ] as const
            ).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={scope === value} onClick={() => setFilters({ scope: value })}>
                {label}
              </button>
            ))}
          </div>
          <select
            className="input select"
            aria-label={s.beanLabel}
            value={beanId ?? ''}
            onChange={(e) => setFilters({ bean: e.target.value || null })}
          >
            <option value="">{s.allBeans}</option>
            {beans.data?.beans.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        {recipes.data?.bean_filter && <p className="filter-note">{s.beanFilterNote(recipes.data.bean_filter.name)}</p>}

        {recipes.isPending && (
          <div className="center-block">
            <div className="spinner" role="status" aria-label={strings.app.loading} />
          </div>
        )}
        {recipes.isError && (
          <div className="list-section">
            <FormError>{errorMessage(recipes.error)}</FormError>
          </div>
        )}
        {recipes.data &&
          (list.length === 0 ? (
            emptyText ? (
              <p className="section muted">{emptyText}</p>
            ) : (
              <section className="empty">
                <h2>{s.emptyTitle}</h2>
                <p>{isOwner ? s.emptyOwnerBody : s.emptyBody}</p>
              </section>
            )
          ) : (
            <ul className="rows list-section">
              {list.map((r, i) => (
                <RecipeItem key={r.id} recipe={r} rank={i + 1} leader={i === 0 && r.duels > 0} />
              ))}
            </ul>
          ))}
      </main>
    </>
  );
}

function RecipeItem({ recipe: r, rank, leader }: { recipe: RecipeRow; rank: number; leader: boolean }) {
  const details = [r.bean_name, s.methods[r.method], formatRatio(r.water_g, r.dose_g), formatTemp(r.temp_c)]
    .filter(Boolean)
    .join(' · ');
  return (
    <li>
      <Link href={`/recipes/${r.id}`} className="row">
        <span className="rank condensed">{s.rank(rank)}</span>
        <span className="row-main">
          <span className="row-title">
            <span className="code">{r.display_code}</span>
            {r.name ?? s.untitled}
            {r.locked && <span className="tag gold">{s.compTag}</span>}
          </span>
          {details && <span className="row-sub">{details}</span>}
        </span>
        <span className="stat-cell">
          <span className={`stat-num condensed${leader ? ' gold' : ''}`}>{r.elo}</span>
          <span className="stat-label">{r.duels ? s.record(r) : s.noDuels}</span>
        </span>
      </Link>
    </li>
  );
}
