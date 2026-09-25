import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useSearch } from 'wouter';
import { METHODS, type Method, type RecipeFields, type RecipeRow } from '../../../shared/types';
import type { RecipeInput } from '../../../shared/schemas';
import { ApiError, api, errorMessage } from '../api';
import {
  FormError,
  NumberField,
  useRevealFirstError,
  SegmentedField,
  SelectField,
  TextAreaField,
  TextField,
  TimeField,
} from '../components/Fields';
import { TopBar } from '../components/TopBar';
import { formatNumber, formatRatio, formatSeconds, parseNumber, parseTime } from '../format';
import { beansQuery, invalidateLibrary, recipeQuery } from '../queries';
import { strings } from '../strings';

const s = strings.recipes;
const f = s.fields;
const t = s.form;

const NUMBER_KEYS = ['dose_g', 'water_g', 'temp_c', 'bloom_water_g', 'bypass_g'] as const;
const TIME_KEYS = ['bloom_ends_s', 'press_starts_s', 'press_duration_s'] as const;
const TEXT_KEYS = [
  'name',
  'filter',
  'grinder',
  'grind_setting',
  'water_recipe',
  'agitation',
  'bypass_temp',
  'other_steps',
  'notes',
] as const;

type Key = keyof RecipeFields;
/** Everything as typed text, except the method. */
type Values = Omit<Record<Key, string>, 'method'> & { method: Method };
type Errors = Partial<Record<Key, string>>;

const emptyValues: Values = {
  name: '',
  bean_id: '',
  method: 'Inverted',
  filter: '',
  dose_g: '',
  water_g: '',
  temp_c: '',
  grinder: '',
  grind_setting: '',
  water_recipe: '',
  bloom_water_g: '',
  bloom_ends_s: '',
  agitation: '',
  press_starts_s: '',
  press_duration_s: '',
  bypass_g: '',
  bypass_temp: '',
  other_steps: '',
  notes: '',
};

function toValues(r: RecipeFields): Values {
  const v: Values = { ...emptyValues, method: r.method, bean_id: r.bean_id ?? '' };
  for (const k of TEXT_KEYS) v[k] = r[k] ?? '';
  for (const k of NUMBER_KEYS) v[k] = formatNumber(r[k]);
  for (const k of TIME_KEYS) v[k] = formatSeconds(r[k]);
  return v;
}

/** Turn typed text into the API shape, or report which fields can't be read. */
function toFields(v: Values): { fields: RecipeFields; errors: Errors } {
  const errors: Errors = {};
  const fields = { ...emptyValues } as unknown as RecipeFields;
  fields.method = v.method;
  fields.bean_id = v.bean_id || null;
  for (const k of TEXT_KEYS) fields[k] = v[k].trim() || null;
  for (const k of NUMBER_KEYS) {
    const n = parseNumber(v[k]);
    if (n === 'invalid') errors[k] = t.numberInvalid;
    fields[k] = n === 'invalid' ? null : n;
  }
  for (const k of TIME_KEYS) {
    const secs = parseTime(v[k]);
    if (secs === 'invalid') errors[k] = t.timeInvalid;
    fields[k] = secs === 'invalid' ? null : secs;
  }
  return { fields, errors };
}

/** Which settings differ from the recipe being cloned (unreadable input counts as changed). */
function changedKeys(v: Values, parent: RecipeFields): Set<Key> {
  const { fields, errors } = toFields(v);
  const changed = new Set<Key>();
  for (const k of Object.keys(emptyValues) as Key[]) {
    if (errors[k] || (fields[k] ?? null) !== (parent[k] ?? null)) changed.add(k);
  }
  return changed;
}

type Mode = { kind: 'new' } | { kind: 'clone'; parentId: string } | { kind: 'edit'; id: string };

/** /recipes/new, /recipes/new?from=<id> (clone and tweak), /recipes/:id/edit */
export function RecipeFormScreen({ editId }: { editId?: string }) {
  const from = new URLSearchParams(useSearch()).get('from');
  const mode: Mode = editId ? { kind: 'edit', id: editId } : from ? { kind: 'clone', parentId: from } : { kind: 'new' };
  const sourceId = mode.kind === 'edit' ? mode.id : mode.kind === 'clone' ? mode.parentId : '';
  const source = useQuery({ ...recipeQuery(sourceId), enabled: Boolean(sourceId) });

  if (sourceId && (source.isPending || source.isError)) {
    return (
      <>
        <TopBar title={t.newTitle} backHref="/recipes" />
        <main className="page shell-main">
          {source.isError ? (
            <FormError>{errorMessage(source.error)}</FormError>
          ) : (
            <div className="center-block">
              <div className="spinner" role="status" aria-label={strings.app.loading} />
            </div>
          )}
        </main>
      </>
    );
  }
  return <RecipeForm key={`${mode.kind}:${sourceId}`} mode={mode} source={source.data?.recipe} />;
}

function RecipeForm({ mode, source }: { mode: Mode; source?: RecipeRow }) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const beans = useQuery(beansQuery);
  const [values, setValues] = useState<Values>(source ? toValues(source) : emptyValues);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  useRevealFirstError(errors);

  const set = (key: Key) => (value: string) => setValues((v) => ({ ...v, [key]: value }));
  const tidyTime = (text: string) => {
    const secs = parseTime(text);
    return typeof secs === 'number' ? formatSeconds(secs) : text;
  };

  const parent = mode.kind === 'clone' ? source : undefined;
  const changed = parent ? changedKeys(values, parent) : new Set<Key>();
  const isChanged = (k: Key) => changed.has(k);

  const save = useMutation({
    mutationFn: (fields: RecipeFields) => {
      if (mode.kind === 'edit') return api<RecipeRow>('PUT', `/api/recipes/${mode.id}`, fields);
      const body: RecipeInput = { ...fields, parent_id: mode.kind === 'clone' ? mode.parentId : null };
      return api<RecipeRow>('POST', '/api/recipes', body);
    },
    onSuccess: async (saved) => {
      await invalidateLibrary(qc);
      navigate(`/recipes/${saved.id}`, { replace: true });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.field) {
        setErrors({ [err.field]: err.message });
        setFormError(t.fixErrors);
      } else setFormError(errorMessage(err));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const { fields, errors: found } = toFields(values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setFormError(t.fixErrors);
      return;
    }
    setFormError(null);
    save.mutate(fields);
  };

  const title =
    mode.kind === 'edit' && source ? t.editTitle(source.display_code) : parent ? t.cloneTitle(parent.display_code) : t.newTitle;
  const backHref = source ? `/recipes/${source.id}` : '/recipes';
  const doseRatio = (() => {
    const water = parseNumber(values.water_g);
    const dose = parseNumber(values.dose_g);
    return typeof water === 'number' && typeof dose === 'number' ? formatRatio(water, dose) : null;
  })();

  const beanOptions = [
    { value: '', label: t.noBean },
    ...(beans.data?.beans.map((b) => ({ value: b.id, label: b.name })) ?? []),
  ];
  const hasHistory = mode.kind === 'edit' && source && (source.brew_count > 0 || source.duels > 0);
  const lockedEdit = mode.kind === 'edit' && source?.locked;

  const field = (key: Key) => ({ error: errors[key], changed: isChanged(key) });

  return (
    <>
      <TopBar title={title} backHref={backHref} />
      <main className="page shell-main">
        {parent && <p className="banner">{t.cloneBanner}</p>}
        {hasHistory && source && !lockedEdit && (
          <div className="banner warn" style={{ display: 'grid', gap: 10 }}>
            <span>{t.history(source.display_code, source.brew_count, source.duels)}</span>
            <button type="button" className="btn secondary" onClick={() => navigate(`/recipes/new?from=${source.id}`, { replace: true })}>
              {t.cloneInstead}
            </button>
          </div>
        )}
        {lockedEdit && <p className="notice">{s.detail.lockedNote}</p>}

        <form className="form" onSubmit={submit} noValidate>
          <div className="form-section">
            <span className="eyebrow">{t.sections.recipe}</span>
            <TextField label={f.name} placeholder={t.placeholders.name} value={values.name} onChange={set('name')} maxLength={80} {...field('name')} />
            <SelectField label={f.bean} value={values.bean_id} onChange={set('bean_id')} options={beanOptions} {...field('bean_id')} />
            <SegmentedField<Method>
              label={f.method}
              value={values.method}
              onChange={(m) => setValues((v) => ({ ...v, method: m }))}
              options={METHODS.map((m) => ({ value: m, label: s.methods[m] ?? m }))}
              {...field('method')}
            />
            <TextField label={f.filter} placeholder={t.placeholders.filter} value={values.filter} onChange={set('filter')} maxLength={60} {...field('filter')} />
          </div>

          <div className="form-section">
            <span className="eyebrow">{t.sections.coffee}</span>
            <div className="field-pair">
              <NumberField label={f.dose} unit={strings.units.g} value={values.dose_g} onChange={set('dose_g')} {...field('dose_g')} />
              <NumberField label={f.water} unit={strings.units.g} value={values.water_g} onChange={set('water_g')} {...field('water_g')} />
            </div>
            {doseRatio && <p className="field-hint" style={{ marginTop: -8 }}>{t.ratio(doseRatio)}</p>}
            <NumberField label={f.temp} unit={strings.units.celsius} value={values.temp_c} onChange={set('temp_c')} {...field('temp_c')} />
            <div className="field-pair">
              <TextField label={f.grinder} placeholder={t.placeholders.grinder} value={values.grinder} onChange={set('grinder')} maxLength={60} {...field('grinder')} />
              <TextField label={f.grind} placeholder={t.placeholders.grind} value={values.grind_setting} onChange={set('grind_setting')} maxLength={40} {...field('grind_setting')} />
            </div>
            <TextField
              label={f.waterRecipe}
              placeholder={t.placeholders.waterRecipe}
              value={values.water_recipe}
              onChange={set('water_recipe')}
              maxLength={120}
              {...field('water_recipe')}
            />
          </div>

          <div className="form-section">
            <span className="eyebrow">{t.sections.steps}</span>
            <div className="field-pair">
              <NumberField label={f.bloomWater} unit={strings.units.g} value={values.bloom_water_g} onChange={set('bloom_water_g')} {...field('bloom_water_g')} />
              <TimeField
                label={f.bloomEnds}
                placeholder={t.placeholders.time}
                value={values.bloom_ends_s}
                onChange={set('bloom_ends_s')}
                onBlurFormat={tidyTime}
                {...field('bloom_ends_s')}
              />
            </div>
            <TextField label={f.agitation} placeholder={t.placeholders.agitation} value={values.agitation} onChange={set('agitation')} maxLength={200} {...field('agitation')} />
            <div className="field-pair">
              <TimeField
                label={f.pressStarts}
                placeholder={t.placeholders.time}
                value={values.press_starts_s}
                onChange={set('press_starts_s')}
                onBlurFormat={tidyTime}
                {...field('press_starts_s')}
              />
              <TimeField
                label={f.pressDuration}
                placeholder={t.placeholders.time}
                value={values.press_duration_s}
                onChange={set('press_duration_s')}
                onBlurFormat={tidyTime}
                {...field('press_duration_s')}
              />
            </div>
            <p className="field-hint" style={{ marginTop: -8 }}>{t.timeHint}</p>
            <div className="field-pair">
              <NumberField label={f.bypass} unit={strings.units.g} value={values.bypass_g} onChange={set('bypass_g')} {...field('bypass_g')} />
              <TextField label={f.bypassTemp} placeholder={t.placeholders.bypassTemp} value={values.bypass_temp} onChange={set('bypass_temp')} maxLength={40} {...field('bypass_temp')} />
            </div>
            <TextAreaField
              label={f.otherSteps}
              placeholder={t.placeholders.otherSteps}
              value={values.other_steps}
              onChange={set('other_steps')}
              maxLength={2000}
              {...field('other_steps')}
            />
          </div>

          <div className="form-section">
            <span className="eyebrow">{t.sections.notes}</span>
            <TextAreaField label={f.notes} placeholder={t.placeholders.notes} value={values.notes} onChange={set('notes')} maxLength={4000} {...field('notes')} />
          </div>

          <div className="save-bar">
            {parent && (
              <span className={`change-count${changed.size > 2 ? ' warn' : ''}`} role="status">
                {t.changes(changed.size, parent.display_code)}
                {changed.size > 2 && <span>{t.tooManyChanges}</span>}
              </span>
            )}
            {formError && <FormError>{formError}</FormError>}
            <button type="submit" className="btn block" disabled={save.isPending || Boolean(lockedEdit)}>
              {save.isPending ? strings.common.saving : mode.kind === 'edit' ? t.save : parent ? t.clone : t.create}
            </button>
          </div>
        </form>
      </main>
    </>
  );
}
