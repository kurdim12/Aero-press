import { type ReactNode, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearch } from 'wouter';
import type { ChampionRecipe, ChampionSetup } from '../../../shared/champions';
import { type Sided, orient, parseRef, refKey, sameRef } from '../../../shared/compare';
import { WINDOW_S, planBrew } from '../../../shared/phases';
import type { CompareFraming, CompareRead, CompareRef, CompareResponse, RecipeRow } from '../../../shared/types';
import { api, errorMessage } from '../api';
import { championsQuery } from '../champions';
import { FormError } from '../components/Fields';
import { SavedReadSection, useSavedRead } from '../components/SavedRead';
import { TopBar } from '../components/TopBar';
import { formatRatio, formatSeconds, formatTemp } from '../format';
import { recipesQuery } from '../queries';
import { type DisplayRecipe, RECIPE_DISPLAY_FIELDS } from '../recipeFields';
import { strings } from '../strings';

const s = strings.recipes;
const c = s.compare;
const ch = strings.champions;

/** One side of a comparison, a team recipe or a champion's, in the shape the table shows. */
interface SideView {
  ref: CompareRef;
  key: string;
  code: string;
  title: string;
  href: string;
  display: DisplayRecipe;
  standing: ReactNode;
  sided: Sided;
}

type Published = ChampionRecipe & { recipe: ChampionSetup };

const published = (list: ChampionRecipe[] | undefined) => (list ?? []).filter((e): e is Published => e.recipe !== null);

function recipeSide(r: RecipeRow): SideView {
  return {
    ref: { kind: 'recipe', id: r.id },
    key: refKey({ kind: 'recipe', id: r.id }),
    code: r.display_code,
    title: r.name ?? s.untitled,
    href: `/recipes/${r.id}`,
    display: r,
    standing: (
      <>
        <strong className="num">{r.elo}</strong>
        <span className="row-sub">{r.duels ? s.record(r) : s.noDuels}</span>
      </>
    ),
    sided: { kind: 'recipe', id: r.id, parent_id: r.parent_id, created_at: r.created_at },
  };
}

function championSide(e: Published): SideView {
  return {
    ref: { kind: 'champion', id: e.id },
    key: refKey({ kind: 'champion', id: e.id }),
    code: ch.code(e.year, e.place),
    title: e.name,
    href: `/recipes/champions/${e.id}`,
    display: { ...e.recipe, name: e.name, bean_id: null, bean_name: null, notes: e.notes },
    standing: (
      <>
        <strong>{ch.place[e.place]}</strong>
        <span className="row-sub">{e.country}</span>
      </>
    ),
    sided: { kind: 'champion', id: e.id, year: e.year, place: e.place },
  };
}

/**
 * /recipes/:id/compare and /recipes/champions/:id/compare, then ?with=<side> once the second is
 * picked ("recipe:<id>", "champion:<id>", or a bare recipe id from older links).
 */
export function CompareScreen({ a, base, backHref }: { a: CompareRef; base: string; backHref: string }) {
  const withRef = parseRef(new URLSearchParams(useSearch()).get('with'));
  const recipes = useQuery(recipesQuery('all', null));
  const champions = useQuery(championsQuery);
  const list = recipes.data?.recipes ?? [];
  const champs = published(champions.data);

  const sideFor = (ref: CompareRef): SideView | null => {
    if (ref.kind === 'recipe') {
      const r = list.find((x) => x.id === ref.id);
      return r ? recipeSide(r) : null;
    }
    const e = champs.find((x) => x.id === ref.id);
    return e ? championSide(e) : null;
  };

  let body;
  if (recipes.isPending || champions.isPending) {
    body = (
      <div className="center-block">
        <div className="spinner" role="status" aria-label={strings.app.loading} />
      </div>
    );
  } else if (recipes.isError || champions.isError) {
    body = <FormError>{errorMessage(recipes.error ?? champions.error)}</FormError>;
  } else {
    const first = sideFor(a);
    const second = withRef && !sameRef(withRef, a) ? sideFor(withRef) : null;
    if (!first) body = <FormError>{strings.errors.byCode.not_found as string}</FormError>;
    else if (!second) body = <Picker current={first} base={base} recipes={list} champions={champs} />;
    // A new pair is a new screen: nothing (a pending tap included) carries over from the last one.
    else body = <Table key={`${first.key}|${second.key}`} a={first} b={second} base={base} recipes={list} />;
  }

  return (
    <>
      <TopBar title={c.title} backHref={backHref} />
      <main className="page shell-main">{body}</main>
    </>
  );
}

function Picker({ current, base, recipes, champions }: { current: SideView; base: string; recipes: RecipeRow[]; champions: Published[] }) {
  const [, navigate] = useLocation();
  const pick = (key: string) => navigate(`${base}?with=${encodeURIComponent(key)}`, { replace: true });
  const ours = recipes.filter((r) => refKey({ kind: 'recipe', id: r.id }) !== current.key);
  const theirs = champions.filter((e) => refKey({ kind: 'champion', id: e.id }) !== current.key);
  return (
    <section>
      <h2 className="hero-name condensed" style={{ fontSize: 26, marginTop: 8 }}>
        {c.pickTitle(current.code)}
      </h2>
      <section className="section">
        <span className="eyebrow">{c.ours}</span>
        {ours.length === 0 ? (
          <p className="muted">{c.nothingToCompare}</p>
        ) : (
          <ul className="rows">
            {ours.map((r) => (
              <li key={r.id}>
                <button type="button" className="row" onClick={() => pick(refKey({ kind: 'recipe', id: r.id }))}>
                  <span className="row-main">
                    <span className="row-title">
                      <span className="code">{r.display_code}</span>
                      {r.name ?? s.untitled}
                    </span>
                    {r.bean_name && <span className="row-sub">{r.bean_name}</span>}
                  </span>
                  <span className="stat-cell">
                    <span className="stat-num condensed">{r.elo}</span>
                    <span className="stat-label">{r.duels ? s.record(r) : s.noDuels}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="section">
        <span className="eyebrow">{c.champions}</span>
        <ul className="rows">
          {theirs.map((e) => (
            <li key={e.id}>
              <button type="button" className="row" onClick={() => pick(refKey({ kind: 'champion', id: e.id }))}>
                <span className={`place condensed${e.place === 1 ? ' gold' : ''}`}>{e.year}</span>
                <span className="row-main">
                  <span className="row-title">{e.name}</span>
                  <span className="row-sub">
                    {[ch.place[e.place], e.country, formatRatio(e.recipe.water_g, e.recipe.dose_g), formatTemp(e.recipe.temp_c)].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

const plannedTime = (r: DisplayRecipe) => {
  const plan = planBrew(r);
  if (plan.missing.length > 0) return '';
  return `${formatSeconds(plan.total)}${plan.fits ? '' : ` (${strings.brew.over(formatSeconds(plan.total - WINDOW_S))})`}`;
};

/**
 * Old before new (or the champion's before ours): the coach's explanation first, then what
 * differs, with every setting a tap away.
 */
function Table({ a, b, base, recipes }: { a: SideView; b: SideView; base: string; recipes: RecipeRow[] }) {
  const [showAll, setShowAll] = useState(false);
  const parentOf = (id: string) => recipes.find((r) => r.id === id)?.parent_id ?? null;
  const o = orient(a.sided, b.sided, parentOf);
  const [first, second] = o.first === 0 ? [a, b] : [b, a];
  const [firstRole, secondRole] = c.roles[o.framing];
  const rows = [
    ...RECIPE_DISPLAY_FIELDS.map((field) => ({ key: field.key, label: field.label, left: field.show(first.display), right: field.show(second.display) })),
    { key: 'planned', label: c.plannedTime, left: plannedTime(first.display), right: plannedTime(second.display) },
  ].map((row) => ({ ...row, differs: row.left !== row.right }));
  // Notes differ between almost any two recipes and change nothing in the cup.
  const differing = rows.filter((r) => r.differs && r.key !== 'notes');
  const shown = showAll ? rows : differing;

  return (
    <section>
      <p className="filter-note" role="status">
        {c.differs(differing.length)}
      </p>
      {differing.length > 0 && <CompareCoach first={first} second={second} framing={o.framing} />}
      <section className="section">
        <span className="eyebrow">{showAll ? c.allSettings : c.whatDiffers}</span>
        <table className="compare-table">
          <thead>
            <tr>
              <th scope="col">{c.setting}</th>
              <ColumnHead side={first} role={firstRole} />
              <ColumnHead side={second} role={secondRole} />
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">{s.fields.name}</th>
              <td>{first.title}</td>
              <td>{second.title}</td>
            </tr>
            <tr>
              <th scope="row">{c.standing}</th>
              <td>{first.standing}</td>
              <td>{second.standing}</td>
            </tr>
            {shown.map((r) => (
              <tr key={r.key} className={showAll && r.differs ? 'diff' : undefined}>
                <th scope="row">{r.label}</th>
                <td>{r.left || strings.common.none}</td>
                <td>{r.right || strings.common.none}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {showAll && differing.length > 0 && <p className="field-hint">{c.legend}</p>}
        <button type="button" className="btn secondary block" style={{ marginTop: 12 }} onClick={() => setShowAll((v) => !v)}>
          {showAll ? c.showDiffering : c.showAll}
        </button>
      </section>
      <div className="section">
        <Link href={base} className="btn secondary block">
          {c.pickAnother}
        </Link>
      </div>
    </section>
  );
}

function ColumnHead({ side, role }: { side: SideView; role: string }) {
  return (
    <th scope="col">
      <span className="compare-role">{role}</span>
      <Link href={side.href} className="link-inline">
        {side.code}
      </Link>
    </th>
  );
}

/** The coach's explanation of the differences, kept for the whole team. */
function CompareCoach({ first, second, framing }: { first: SideView; second: SideView; framing: CompareFraming }) {
  const saved = useSavedRead<CompareRead>(
    ['compare-read', ...[first.key, second.key].sort()],
    `/api/coach/compare?a=${encodeURIComponent(first.key)}&b=${encodeURIComponent(second.key)}`,
    (refresh, seen) => api<CompareResponse>('POST', '/api/coach/compare', { a: first.ref, b: second.ref, refresh, seen }),
  );
  return (
    <SavedReadSection
      saved={saved}
      labels={{ title: c.coach, button: c.explain, hint: c.explainHint, loading: c.explaining, again: c.explainAgain, stale: c.stale }}
      render={(read) => <Explanation read={read} first={first} second={second} framing={framing} />}
    />
  );
}

function Explanation({ read, first, second, framing }: { read: CompareRead; first: SideView; second: SideView; framing: CompareFraming }) {
  // Each change's "from" is the value in the side the coach explained first.
  const [from, to] = read.first === second.key ? [second, first] : [first, second];
  return (
    <>
      <div className="coach-card">
        <p className="coach-read">{read.summary}</p>
      </div>
      <ol className="explain-list">
        {read.changes.map((change, i) => (
          <li key={i} className="explain-item">
            <h3 className="explain-title">{change.setting}</h3>
            <p className="explain-values">
              <span className="code">{from.code}</span> {change.from || strings.common.none}
              <span aria-hidden="true"> → </span>
              <span className="code">{to.code}</span> {change.to || strings.common.none}
            </p>
            <p>
              <strong>{c.why}: </strong>
              {change.why}
            </p>
            <p>
              <strong>{c.how}: </strong>
              {change.how}
            </p>
            <p>
              <strong>{c.cup}: </strong>
              {change.cup}
            </p>
          </li>
        ))}
      </ol>
      <h3 className="subhead">{c.verdict[framing]}</h3>
      <p>{read.verdict}</p>
      <h3 className="subhead">{c.next}</h3>
      <p>{read.next}</p>
    </>
  );
}
