import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useSearch } from 'wouter';
import type { DuelView } from '../../../shared/types';
import { ApiError, api, errorMessage } from '../api';
import { FormError, SelectField, TextAreaField, ToggleField, useRevealFirstError } from '../components/Fields';
import { TopBar } from '../components/TopBar';
import { beansQuery, recipesQuery } from '../queries';
import { membersQuery, useMe } from '../session';
import { strings } from '../strings';

const d = strings.duel;
const MAX_JUDGES = 3;

/** /duel/new (?a=&b= to prefill the recipes). */
export function DuelNewScreen() {
  const me = useMe();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(useSearch());
  const recipes = useQuery(recipesQuery('all', null));
  const beans = useQuery(beansQuery);
  const members = useQuery(membersQuery);

  const [recipeA, setRecipeA] = useState(params.get('a') ?? '');
  const [recipeB, setRecipeB] = useState(params.get('b') ?? '');
  const [beanId, setBeanId] = useState<string | null>(null);
  const [judges, setJudges] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useRevealFirstError(errors);

  // Default bean: the competition coffee if one is marked, else recipe A's bean.
  const list = recipes.data?.recipes ?? [];
  const compCoffee = beans.data?.beans.find((b) => b.is_competition_coffee)?.id;
  const bean = beanId ?? compCoffee ?? list.find((x) => x.id === recipeA)?.bean_id ?? '';

  const candidates = (members.data?.members ?? []).filter((m) => m.active && m.id !== me.member.id);

  const recipeOptions = [
    { value: '', label: d.pickRecipe },
    ...list.map((x) => ({ value: x.id, label: `${x.display_code} ${x.name ?? ''} · ${x.elo}`.replace('  ', ' ') })),
  ];
  const beanOptions = [{ value: '', label: d.noBean }, ...(beans.data?.beans.map((b) => ({ value: b.id, label: b.name })) ?? [])];

  const toggleJudge = (id: string, on: boolean) =>
    setJudges((current) => (on ? [...current, id].slice(0, MAX_JUDGES) : current.filter((x) => x !== id)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!recipeA) found.recipe_a_id = d.pickBoth;
    if (!recipeB) found.recipe_b_id = d.pickBoth;
    else if (recipeA === recipeB) found.recipe_b_id = d.sameRecipe;
    if (judges.length === 0) found.judge_ids = d.pickJudges;
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setFormError(strings.recipes.form.fixErrors);
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const duel = await api<DuelView>('POST', '/api/duels', {
        recipe_a_id: recipeA,
        recipe_b_id: recipeB,
        bean_id: bean || null,
        judge_ids: judges,
        notes: notes.trim() || null,
      });
      qc.setQueryData(['duel', duel.id], duel);
      void qc.invalidateQueries({ queryKey: ['duels'] });
      navigate(`/duel/${duel.id}`, { replace: true });
    } catch (err) {
      setSaving(false);
      if (err instanceof ApiError && err.field) {
        setErrors({ [err.field]: err.message });
        setFormError(strings.recipes.form.fixErrors);
      } else setFormError(errorMessage(err));
    }
  };

  const loading = recipes.isPending || members.isPending;

  return (
    <>
      <TopBar title={d.newTitle} backHref="/duel" />
      <main className="page shell-main">
        {loading ? (
          <div className="center-block">
            <div className="spinner" role="status" aria-label={strings.app.loading} />
          </div>
        ) : list.length < 2 ? (
          <p className="notice" style={{ marginTop: 12 }}>
            {d.needTwoRecipes}
          </p>
        ) : (
          <form className="form" onSubmit={(e) => void submit(e)} noValidate>
            <div className="form-section" style={{ paddingTop: 12 }}>
              <SelectField label={d.recipeA} value={recipeA} onChange={setRecipeA} options={recipeOptions} error={errors.recipe_a_id} />
              <SelectField label={d.recipeB} value={recipeB} onChange={setRecipeB} options={recipeOptions} error={errors.recipe_b_id} />
              <SelectField label={d.bean} value={bean} onChange={setBeanId} options={beanOptions} error={errors.bean_id} />
            </div>
            <div className="form-section">
              <span className="eyebrow">{d.judges}</span>
              <p className="field-hint" style={{ marginTop: -8 }}>
                {d.judgesHint}
              </p>
              {candidates.length === 0 ? (
                <p className="notice">{d.noJudges}</p>
              ) : (
                candidates.map((m) => (
                  <ToggleField
                    key={m.id}
                    label={m.name}
                    checked={judges.includes(m.id)}
                    disabled={!judges.includes(m.id) && judges.length >= MAX_JUDGES}
                    onChange={(on) => toggleJudge(m.id, on)}
                  />
                ))
              )}
              {errors.judge_ids && <p className="field-error">{errors.judge_ids}</p>}
            </div>
            <div className="form-section">
              <TextAreaField
                label={d.notes}
                placeholder={d.notesPlaceholder}
                hint={d.notesHint}
                value={notes}
                onChange={setNotes}
                maxLength={500}
                error={errors.notes}
              />
            </div>
            <div className="save-bar">
              {formError && <FormError>{formError}</FormError>}
              <button type="submit" className="btn block" disabled={saving || candidates.length === 0}>
                {saving ? d.submitting : d.submit}
              </button>
            </div>
          </form>
        )}
      </main>
    </>
  );
}
