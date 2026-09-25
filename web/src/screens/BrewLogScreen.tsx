import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useSearch } from 'wouter';
import type { RecipeRow } from '../../../shared/types';
import { extractionYield } from '../../../shared/formulas';
import { BREW_LIMITS } from '../../../shared/limits';
import { rememberBrewedRecipe } from '../brew/lastBrewed';
import { getTimer, resetBrew } from '../brew/timer';
import { ApiError, errorMessage } from '../api';
import {
  FormError,
  NumberField,
  SelectField,
  TextAreaField,
  TextField,
  TimeField,
  useRevealFirstError,
} from '../components/Fields';
import { ScoreSlider } from '../components/ScoreSlider';
import { TopBar } from '../components/TopBar';
import { setFlash } from '../flash';
import { formatNumber, formatPercent, formatSeconds, parseNumber, parseTime } from '../format';
import { newClientId } from '../ids';
import { submitBrew } from '../offline/brewSync';
import { beansQuery, invalidateLibrary, recipesQuery } from '../queries';
import { useMe } from '../session';
import { strings } from '../strings';

const l = strings.brew.log;
const SCORE_KEYS = ['sweetness', 'acidity', 'body', 'clarity', 'finish', 'overall'] as const;
type ScoreKey = (typeof SCORE_KEYS)[number];

/** /brew/:id/log (?time=seconds from the timer). Works offline: the brew waits on the phone. */
export function BrewLogScreen({ id }: { id: string }) {
  const recipes = useQuery(recipesQuery('all', null));
  const recipe = recipes.data?.recipes.find((r) => r.id === id);
  const time = Number(new URLSearchParams(useSearch()).get('time'));

  if (!recipe) {
    return (
      <>
        <TopBar title={l.title} backHref="/brew" />
        <main className="page shell-main">
          {recipes.isPending ? (
            <div className="center-block">
              <div className="spinner" role="status" aria-label={strings.app.loading} />
            </div>
          ) : (
            <FormError>{strings.brew.missingRecipe}</FormError>
          )}
        </main>
      </>
    );
  }
  return <LogForm recipe={recipe} initialTime={Number.isFinite(time) && time > 0 ? time : null} />;
}

type Values = { bean_id: string; grind_used: string; total_time_s: string; tds_pct: string; beverage_g: string; notes: string };

/**
 * The API's own range, checked before saving: a brew saved offline can't be corrected once
 * the server refuses it on sync.
 */
function measureError(value: number | null | 'invalid', limits: { min: number; max: number }): string | undefined {
  if (value === 'invalid') return strings.recipes.form.numberInvalid;
  if (value !== null && (value < limits.min || value > limits.max)) {
    return l.outOfRange(formatNumber(limits.min), formatNumber(limits.max));
  }
  return undefined;
}

function LogForm({ recipe, initialTime }: { recipe: RecipeRow; initialTime: number | null }) {
  const me = useMe();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const beans = useQuery(beansQuery);
  const [values, setValues] = useState<Values>({
    bean_id: recipe.bean_id ?? '',
    grind_used: recipe.grind_setting ?? '',
    total_time_s: initialTime ? formatSeconds(initialTime) : '',
    tds_pct: '',
    beverage_g: '',
    notes: '',
  });
  const [scores, setScores] = useState<Record<ScoreKey, number | null>>({
    sweetness: null,
    acidity: null,
    body: null,
    clarity: null,
    finish: null,
    overall: null,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useRevealFirstError(errors);

  const set = (key: keyof Values) => (value: string) => setValues((v) => ({ ...v, [key]: value }));
  const tds = parseNumber(values.tds_pct);
  const beverage = parseNumber(values.beverage_g);
  const ey = typeof tds === 'number' && typeof beverage === 'number' ? extractionYield(tds, beverage, recipe.dose_g) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    const time = parseTime(values.total_time_s);
    if (time === 'invalid') found.total_time_s = strings.recipes.form.timeInvalid;
    else if (time !== null && time > BREW_LIMITS.total_time_s.max) {
      found.total_time_s = l.timeTooLong(formatSeconds(BREW_LIMITS.total_time_s.max));
    }
    const tdsError = measureError(tds, BREW_LIMITS.tds_pct);
    if (tdsError) found.tds_pct = tdsError;
    const beverageError = measureError(beverage, BREW_LIMITS.beverage_g);
    if (beverageError) found.beverage_g = beverageError;
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setFormError(strings.recipes.form.fixErrors);
      return;
    }
    setFormError(null);
    setSaving(true);
    const body = {
      id: newClientId(),
      brewed_at: Date.now(),
      recipe_id: recipe.id,
      bean_id: values.bean_id || null,
      grind_used: values.grind_used.trim() || null,
      total_time_s: time === 'invalid' ? null : time,
      tds_pct: tds === 'invalid' ? null : tds,
      beverage_g: beverage === 'invalid' ? null : beverage,
      ...scores,
      notes: values.notes.trim() || null,
    };
    try {
      const result = await submitBrew(body, me.member.id, `${recipe.display_code} ${recipe.name ?? ''}`.trim());
      rememberBrewedRecipe(recipe.id);
      if (getTimer().recipeId === recipe.id) resetBrew();
      if ('saved' in result) {
        setFlash(l.saved);
        // Not awaited: if the connection drops right now, the refresh waits for it, the screen shouldn't.
        void invalidateLibrary(qc);
        navigate(`/recipes/${recipe.id}`);
      } else {
        setFlash(l.queued);
        navigate('/brew');
      }
    } catch (err) {
      setSaving(false);
      if (err instanceof ApiError && err.field) {
        setErrors({ [err.field]: err.message });
        setFormError(strings.recipes.form.fixErrors);
      } else setFormError(errorMessage(err));
    }
  };

  const beanList = beans.data?.beans ?? [];
  const beanOptions = [
    { value: '', label: l.noBean },
    ...beanList.map((b) => ({ value: b.id, label: b.name })),
    // Bean list not on this phone yet: the recipe's own bean still shows by name.
    ...(recipe.bean_id && !beanList.some((b) => b.id === recipe.bean_id)
      ? [{ value: recipe.bean_id, label: recipe.bean_name ?? '' }]
      : []),
  ];

  return (
    <>
      <TopBar title={l.title} backHref={`/brew/${recipe.id}`} />
      <main className="page shell-main">
        <p className="brew-name" style={{ marginTop: 8 }}>
          <span className="code">{recipe.display_code}</span>
          {recipe.name ?? strings.recipes.untitled}
        </p>
        <form className="form" onSubmit={(e) => void submit(e)} noValidate>
          <div className="form-section" style={{ paddingTop: 12 }}>
            <SelectField label={l.bean} value={values.bean_id} onChange={set('bean_id')} options={beanOptions} error={errors.bean_id} />
            <div className="field-pair">
              <TextField label={l.grind} value={values.grind_used} onChange={set('grind_used')} maxLength={40} error={errors.grind_used} />
              <TimeField
                label={l.totalTime}
                placeholder={strings.recipes.form.placeholders.time}
                value={values.total_time_s}
                onChange={set('total_time_s')}
                onBlurFormat={(text) => {
                  const secs = parseTime(text);
                  return typeof secs === 'number' ? formatSeconds(secs) : text;
                }}
                error={errors.total_time_s}
              />
            </div>
            <div className="field-pair">
              <NumberField label={l.tds} unit={strings.units.percent} value={values.tds_pct} onChange={set('tds_pct')} error={errors.tds_pct} />
              <NumberField label={l.beverage} unit={strings.units.g} value={values.beverage_g} onChange={set('beverage_g')} error={errors.beverage_g} />
            </div>
            <p className={ey === null ? 'field-hint' : 'ey-line'} role="status">
              {ey === null ? l.eyNeeds : l.ey(formatPercent(ey, 2))}
            </p>
          </div>

          <div className="form-section">
            <span className="eyebrow">{l.scores}</span>
            <p className="field-hint" style={{ marginTop: -8 }}>
              {l.scoresHint}
            </p>
            {SCORE_KEYS.map((key) => (
              <ScoreSlider
                key={key}
                label={l.scoreLabels[key]}
                value={scores[key]}
                onChange={(v) => setScores((s) => ({ ...s, [key]: v }))}
                error={errors[key]}
              />
            ))}
          </div>

          <div className="form-section">
            <TextAreaField
              label={l.notes}
              placeholder={l.notesPlaceholder}
              value={values.notes}
              onChange={set('notes')}
              maxLength={2000}
              error={errors.notes}
            />
          </div>

          <div className="save-bar">
            {formError && <FormError>{formError}</FormError>}
            <button type="submit" className="btn block" disabled={saving}>
              {saving ? strings.common.saving : l.save}
            </button>
          </div>
        </form>
      </main>
    </>
  );
}
