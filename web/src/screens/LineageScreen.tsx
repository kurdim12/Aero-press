import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import type { RecipeRow } from '../../../shared/types';
import { errorMessage } from '../api';
import { FormError } from '../components/Fields';
import { TopBar } from '../components/TopBar';
import { recipesQuery } from '../queries';
import { strings } from '../strings';

const s = strings.recipes;

/** The family tree around one recipe: from its first ancestor down through every version. */
export function LineageScreen({ id }: { id: string }) {
  const recipes = useQuery(recipesQuery('all', null));

  let body;
  if (recipes.isPending) {
    body = (
      <div className="center-block">
        <div className="spinner" role="status" aria-label={strings.app.loading} />
      </div>
    );
  } else if (recipes.isError) {
    body = <FormError>{errorMessage(recipes.error)}</FormError>;
  } else {
    body = <Tree list={recipes.data.recipes} currentId={id} />;
  }
  return (
    <>
      <TopBar title={s.lineage.title} backHref={`/recipes/${id}`} />
      <main className="page shell-main">{body}</main>
    </>
  );
}

function Tree({ list, currentId }: { list: RecipeRow[]; currentId: string }) {
  const byId = new Map(list.map((r) => [r.id, r]));
  const current = byId.get(currentId);
  if (!current) return <FormError>{strings.errors.byCode.not_found as string}</FormError>;

  // Walk up to the first ancestor (guarding against a loop in bad data).
  let root = current;
  const seen = new Set<string>([root.id]);
  while (root.parent_id && byId.has(root.parent_id) && !seen.has(root.parent_id)) {
    root = byId.get(root.parent_id) as RecipeRow;
    seen.add(root.id);
  }

  const children = new Map<string, RecipeRow[]>();
  for (const r of list) {
    if (!r.parent_id) continue;
    const siblings = children.get(r.parent_id) ?? [];
    siblings.push(r);
    children.set(r.parent_id, siblings);
  }
  for (const siblings of children.values()) siblings.sort((x, y) => x.created_at - y.created_at);

  const drawn = new Set<string>();
  const renderNode = (r: RecipeRow) => {
    if (drawn.has(r.id)) return null;
    drawn.add(r.id);
    const kids = children.get(r.id) ?? [];
    return (
      <li key={r.id}>
        <Link href={`/recipes/${r.id}`} className={`tree-node${r.id === currentId ? ' current' : ''}`}>
          <span className="row-main">
            <span className="row-title">
              <span className="code">{r.display_code}</span>
              {r.name ?? s.untitled}
            </span>
            <span className="row-sub">
              {r.id === currentId ? s.lineage.current : [r.bean_name, r.duels ? s.record(r) : s.noDuels].filter(Boolean).join(' · ')}
            </span>
          </span>
          <span className="stat-cell">
            <span className="stat-num condensed">{r.elo}</span>
            <span className="stat-label">{s.elo}</span>
          </span>
        </Link>
        {kids.length > 0 && <ul>{kids.map(renderNode)}</ul>}
      </li>
    );
  };

  return (
    <section>
      <p className="filter-note">{s.lineage.intro}</p>
      <ul className="tree list-section">{renderNode(root)}</ul>
    </section>
  );
}
