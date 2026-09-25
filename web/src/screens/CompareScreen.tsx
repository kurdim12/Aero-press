import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearch } from 'wouter';
import type { RecipeRow } from '../../../shared/types';
import { errorMessage } from '../api';
import { FormError } from '../components/Fields';
import { TopBar } from '../components/TopBar';
import { recipesQuery } from '../queries';
import { RECIPE_DISPLAY_FIELDS } from '../recipeFields';
import { strings } from '../strings';

const s = strings.recipes;
const c = s.compare;

/** /recipes/:id/compare, then ?with=<other id> once a second recipe is picked. */
export function CompareScreen({ id }: { id: string }) {
  const withId = new URLSearchParams(useSearch()).get('with');
  const recipes = useQuery(recipesQuery('all', null));
  const list = recipes.data?.recipes ?? [];
  const a = list.find((r) => r.id === id);
  const b = withId ? list.find((r) => r.id === withId) : undefined;
  const backHref = `/recipes/${id}`;

  let body;
  if (recipes.isPending) {
    body = (
      <div className="center-block">
        <div className="spinner" role="status" aria-label={strings.app.loading} />
      </div>
    );
  } else if (recipes.isError) {
    body = <FormError>{errorMessage(recipes.error)}</FormError>;
  } else if (!a) {
    body = <FormError>{strings.errors.byCode.not_found as string}</FormError>;
  } else if (!b) {
    body = <Picker current={a} list={list} />;
  } else {
    body = <Table a={a} b={b} />;
  }

  return (
    <>
      <TopBar title={c.title} backHref={backHref} />
      <main className="page shell-main">{body}</main>
    </>
  );
}

function Picker({ current, list }: { current: RecipeRow; list: RecipeRow[] }) {
  const [, navigate] = useLocation();
  const others = list.filter((r) => r.id !== current.id);
  return (
    <section>
      <h2 className="hero-name condensed" style={{ fontSize: 26, marginTop: 8 }}>
        {c.pickTitle(current.display_code)}
      </h2>
      {others.length === 0 ? (
        <p className="section muted">{c.nothingToCompare}</p>
      ) : (
        <ul className="rows list-section">
          {others.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="row"
                onClick={() => navigate(`/recipes/${current.id}/compare?with=${r.id}`, { replace: true })}
              >
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
  );
}

function Table({ a, b }: { a: RecipeRow; b: RecipeRow }) {
  const rows = RECIPE_DISPLAY_FIELDS.map((field) => {
    const left = field.show(a);
    const right = field.show(b);
    return { key: field.key, label: field.label, left, right, differs: left !== right };
  });
  const differing = rows.filter((r) => r.differs).length;
  const standing = (r: RecipeRow) => (
    <>
      <strong className="num">{r.elo}</strong>
      <span className="row-sub">{r.duels ? s.record(r) : s.noDuels}</span>
    </>
  );

  return (
    <section>
      <p className="filter-note" role="status">
        {c.differs(differing)}
        {differing > 0 && ` · ${c.legend}`}
      </p>
      <table className="compare-table">
        <thead>
          <tr>
            <th scope="col">{c.setting}</th>
            <th scope="col">
              <Link href={`/recipes/${a.id}`} className="link-inline">
                {a.display_code}
              </Link>
            </th>
            <th scope="col">
              <Link href={`/recipes/${b.id}`} className="link-inline">
                {b.display_code}
              </Link>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">{s.fields.name}</th>
            <td>{a.name ?? s.untitled}</td>
            <td>{b.name ?? s.untitled}</td>
          </tr>
          <tr>
            <th scope="row">{s.elo}</th>
            <td>{standing(a)}</td>
            <td>{standing(b)}</td>
          </tr>
          {rows.map((r) => (
            <tr key={r.key} className={r.differs ? 'diff' : undefined}>
              <th scope="row">{r.label}</th>
              <td>{r.left || strings.common.none}</td>
              <td>{r.right || strings.common.none}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="section">
        <Link href={`/recipes/${a.id}/compare`} className="btn secondary block">
          {c.pickAnother}
        </Link>
      </div>
    </section>
  );
}
