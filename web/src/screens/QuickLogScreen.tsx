import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import type { QuickLogResponse } from '../../../shared/types';
import { QuickLogBox, filledCount } from '../components/QuickLogBox';
import { SelectField } from '../components/Fields';
import { TopBar } from '../components/TopBar';
import { stashBrewDraft } from '../drafts';
import { recipesQuery } from '../queries';
import { strings } from '../strings';

const q = strings.quickLog;

/** /brew/quick: say the brew first; the log form opens filled in on the recipe the coach heard. */
export function QuickLogScreen() {
  const [, navigate] = useLocation();
  const recipes = useQuery(recipesQuery('all', null)).data?.recipes ?? [];
  const [result, setResult] = useState<QuickLogResponse | null>(null);
  const [recipeId, setRecipeId] = useState('');

  const open = (id: string, r: QuickLogResponse) => {
    const { recipeMatch: _r, beanMatch: _b, recipe_id: _id, ...fields } = r;
    navigate(`/brew/${id}/log?draft=${stashBrewDraft(fields)}`, { replace: true });
  };

  const onResult = (r: QuickLogResponse) => {
    // A confident match goes straight to the form; anything else asks which recipe it was.
    if (r.recipe_id && r.recipeMatch.confidence >= 0.6) {
      open(r.recipe_id, r);
      return;
    }
    setResult(r);
    setRecipeId(r.recipe_id ?? '');
  };

  return (
    <>
      <TopBar title={q.title} backHref="/brew" />
      <main className="page shell-main">
        <section className="section">
          <QuickLogBox onResult={onResult} />
        </section>
        {result && (
          <section className="section form">
            <p className="notice" role="status">
              {filledCount(result) ? q.filled : q.nothingFound}
            </p>
            <SelectField
              label={q.pickRecipe}
              value={recipeId}
              onChange={setRecipeId}
              options={[{ value: '', label: strings.duel.pickRecipe }, ...recipes.map((r) => ({ value: r.id, label: `${r.display_code} ${r.name ?? ''}`.trim() }))]}
            />
            <button type="button" className="btn block" disabled={!recipeId} onClick={() => open(recipeId, result)}>
              {q.continue}
            </button>
          </section>
        )}
      </main>
    </>
  );
}
