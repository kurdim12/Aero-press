import { Link } from 'wouter';
import type { BeanRow, Experiment, RecipeFields, RecipeRow } from '../../../shared/types';
import { experimentHref } from '../ai';
import { COLUMN_LABELS, formatColumn } from '../recipeFields';
import { strings } from '../strings';

const c = strings.coach;

/** One AI experiment: what changes versus the parent, why, what to listen for, and a way to make it. */
export function ExperimentCard({
  experiment: e,
  recipes,
  beans,
  action = c.createRecipe,
}: {
  experiment: Experiment;
  recipes: RecipeRow[];
  beans: BeanRow[];
  action?: string;
}) {
  const parent = recipes.find((r) => r.id === e.parent_id);
  const beanName = (id: string) => beans.find((b) => b.id === id)?.name;
  const entries = (Object.entries(e.changes) as [keyof RecipeFields, unknown][]).filter(([k]) => k !== 'name' && k !== 'notes');
  return (
    <article className="experiment">
      <h3 className="experiment-title">{e.title}</h3>
      <p className="row-sub">{parent ? c.from(parent.display_code) : e.parent ? c.from(e.parent) : c.newRecipe}</p>
      {entries.length > 0 && (
        <dl className="kv-list">
          {entries.map(([key, value]) => (
            <div key={key} className="kv">
              <dt>{COLUMN_LABELS[key]}</dt>
              <dd>
                {formatColumn(key, value, beanName)}
                {parent && <span className="was"> {c.was(formatColumn(key, parent[key], beanName))}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p>
        <strong>{c.why}: </strong>
        {e.why}
      </p>
      <p>
        <strong>{c.listenFor}: </strong>
        {e.listenFor}
      </p>
      <Link href={experimentHref(e)} className="btn secondary block">
        {action}
      </Link>
    </article>
  );
}
