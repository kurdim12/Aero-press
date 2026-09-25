import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import type { BrewAverages, BrewRow, RecipeRow } from '../../../shared/types';
import { WINDOW_S, planBrew } from '../../../shared/phases';
import { api, errorMessage } from '../api';
import { FormError } from '../components/Fields';
import { TopBar } from '../components/TopBar';
import { useFlash } from '../flash';
import { formatDate, formatNumber, formatPercent, formatSeconds } from '../format';
import { invalidateLibrary, recipeQuery } from '../queries';
import { RECIPE_DISPLAY_FIELDS } from '../recipeFields';
import { useMe } from '../session';
import { strings } from '../strings';

const s = strings.recipes;
const d = s.detail;

export function RecipeDetailScreen({ id }: { id: string }) {
  const detail = useQuery(recipeQuery(id));
  const flash = useFlash();

  if (detail.isPending) {
    return (
      <>
        <TopBar title={s.title} backHref="/recipes" />
        <div className="center-block">
          <div className="spinner" role="status" aria-label={strings.app.loading} />
        </div>
      </>
    );
  }
  if (detail.isError) {
    return (
      <>
        <TopBar title={s.title} backHref="/recipes" />
        <main className="page shell-main">
          <FormError>{errorMessage(detail.error)}</FormError>
        </main>
      </>
    );
  }
  const { recipe, brews, averages } = detail.data;
  return (
    <>
      <TopBar title={recipe.display_code} backHref="/recipes" />
      <main className="page shell-main">
        {flash && (
          <p className="notice" role="status" style={{ marginTop: 8 }}>
            {flash}
          </p>
        )}
        <Hero recipe={recipe} />
        <Actions recipe={recipe} />
        <section className="section">
          <span className="eyebrow">{d.setup}</span>
          <dl className="kv-list">
            {RECIPE_DISPLAY_FIELDS.map((field) => (
              <div className="kv" key={field.key}>
                <dt>{field.label}</dt>
                <dd>{field.show(recipe) || strings.common.none}</dd>
              </div>
            ))}
            <PlannedTime recipe={recipe} />
          </dl>
        </section>
        <Averages averages={averages} />
        <Brews brews={brews} />
      </main>
    </>
  );
}

function Hero({ recipe: r }: { recipe: RecipeRow }) {
  return (
    <section className="hero">
      {r.locked && <span className="tag gold" style={{ justifySelf: 'start' }}>{d.lockedTag}</span>}
      <h2 className="hero-name condensed">{r.name ?? s.untitled}</h2>
      <p className="muted">{[r.bean_name, d.by(r.owner_name)].filter(Boolean).join(' · ')}</p>
      {r.parent_id && r.parent_display_code && (
        <Link href={`/recipes/${r.parent_id}`} className="link-inline">
          {d.versionOf(r.parent_display_code)}
        </Link>
      )}
      <div className="hero-meta">
        <div>
          <div className="elo-big condensed">{r.elo}</div>
          <div className="elo-caption">
            {s.elo} · {r.duels ? `${s.recordLabel} ${s.record(r)} · ${s.duels(r.duels)}` : s.noDuels}
          </div>
        </div>
      </div>
    </section>
  );
}

function Actions({ recipe: r }: { recipe: RecipeRow }) {
  const me = useMe();
  const qc = useQueryClient();
  const isOwner = me.member.role === 'owner';
  const canEdit = (isOwner || r.owner_member_id === me.member.id) && !r.locked;
  const lock = useMutation({
    mutationFn: (locked: boolean) => api<RecipeRow>('PUT', `/api/recipes/${r.id}/lock`, { locked }),
    onSuccess: () => invalidateLibrary(qc),
  });

  return (
    <div className="btn-stack">
      <Link href={`/recipes/new?from=${r.id}`} className="btn block">
        {d.cloneAndTweak}
      </Link>
      <div className="action-row">
        <Link href={`/brew/${r.id}`} className="btn secondary">
          {strings.brew.brewThis}
        </Link>
        <Link href={`/brew/${r.id}/log`} className="btn secondary">
          {strings.brew.logBrew}
        </Link>
        <Link href={`/recipes/${r.id}/compare`} className="btn secondary">
          {d.compare}
        </Link>
        <Link href={`/recipes/${r.id}/lineage`} className="btn secondary">
          {d.lineage}
        </Link>
        {canEdit && (
          <Link href={`/recipes/${r.id}/edit`} className="btn secondary">
            {d.edit}
          </Link>
        )}
      </div>
      {isOwner && (
        <button type="button" className="btn secondary block" onClick={() => lock.mutate(!r.locked)} disabled={lock.isPending}>
          {r.locked ? d.unlock : d.lock}
        </button>
      )}
      {lock.isError && <FormError>{errorMessage(lock.error)}</FormError>}
      {r.locked && <p className="notice">{isOwner ? d.lockedNoteOwner : d.lockedNote}</p>}
    </div>
  );
}

/** Planned total from the brew steps, and whether it fits the 5-minute window. */
function PlannedTime({ recipe }: { recipe: RecipeRow }) {
  const plan = planBrew(recipe);
  if (plan.missing.length > 0) return null;
  return (
    <div className="kv">
      <dt>{d.plannedTime}</dt>
      <dd className={plan.fits ? undefined : 'warn-text'}>
        {formatSeconds(plan.total)} · {plan.fits ? strings.brew.fits : strings.brew.over(formatSeconds(plan.total - WINDOW_S))}
      </dd>
    </div>
  );
}

function Averages({ averages: a }: { averages: BrewAverages }) {
  if (a.count === 0) {
    return (
      <section className="section">
        <span className="eyebrow">{d.averages}</span>
        <p className="muted">{d.noBrews}</p>
      </section>
    );
  }
  const rows: Array<[string, string]> = [
    [d.scores.overall, formatNumber(a.overall, 1)],
    [d.scores.sweetness, formatNumber(a.sweetness, 1)],
    [d.scores.acidity, formatNumber(a.acidity, 1)],
    [d.scores.body, formatNumber(a.body, 1)],
    [d.scores.clarity, formatNumber(a.clarity, 1)],
    [d.scores.finish, formatNumber(a.finish, 1)],
    [d.scores.tds, formatPercent(a.tds_pct, 2)],
    [d.scores.ey, formatPercent(a.ey_pct, 1)],
  ];
  return (
    <section className="section">
      <span className="eyebrow">
        {d.averages} · {d.averagesFrom(a.count)}
      </span>
      <dl className="kv-list">
        {rows.map(([label, value]) => (
          <div className="kv" key={label}>
            <dt>{label}</dt>
            <dd className="num">{value || strings.common.none}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Brews({ brews }: { brews: BrewRow[] }) {
  if (brews.length === 0) return null;
  return (
    <section className="section">
      <span className="eyebrow">{d.brews}</span>
      <ul className="rows">
        {brews.map((b) => {
          const numbers = [
            b.overall != null ? d.overallShort(formatNumber(b.overall, 1)) : '',
            b.tds_pct != null ? `${d.scores.tds} ${formatPercent(b.tds_pct, 2)}` : '',
            b.ey_pct != null ? `${d.scores.ey} ${formatPercent(b.ey_pct, 1)}` : '',
          ].filter(Boolean);
          const context = [b.member_initials, formatSeconds(b.total_time_s), b.bean_name].filter(Boolean);
          return (
            <li key={b.id} className="row brew-row">
              <span className="brew-when">{formatDate(b.created_at)}</span>
              <span className="row-main">
                <span className="row-title num">{numbers.join(' · ') || strings.common.none}</span>
                <span className="row-sub">{context.join(' · ')}</span>
                {b.notes && <span className="row-sub">{b.notes}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {brews.length >= 200 && <p className="muted small">{d.latestOnly}</p>}
    </section>
  );
}
