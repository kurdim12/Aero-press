import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import type { BeanRow } from '../../../shared/types';
import type { BeanInput } from '../../../shared/schemas';
import { daysOffRoast } from '../../../shared/formulas';
import { ApiError, api, errorMessage } from '../api';
import { FormError, TextAreaField, TextField, ToggleField, useRevealFirstError } from '../components/Fields';
import { TopBar } from '../components/TopBar';
import { beanQuery, invalidateLibrary } from '../queries';
import { useIsOwner } from '../session';
import { strings } from '../strings';

const s = strings.beans;
const f = s.form;

type Values = {
  name: string;
  roaster: string;
  origin: string;
  variety: string;
  process: string;
  roast_level: string;
  roast_date: string;
  altitude: string;
  density_notes: string;
  notes: string;
  is_competition_coffee: boolean;
};

const blank: Values = {
  name: '',
  roaster: '',
  origin: '',
  variety: '',
  process: '',
  roast_level: '',
  roast_date: '',
  altitude: '',
  density_notes: '',
  notes: '',
  is_competition_coffee: false,
};

const fromBean = (b: BeanRow): Values => ({
  name: b.name,
  roaster: b.roaster ?? '',
  origin: b.origin ?? '',
  variety: b.variety ?? '',
  process: b.process ?? '',
  roast_level: b.roast_level ?? '',
  roast_date: b.roast_date ?? '',
  altitude: b.altitude ?? '',
  density_notes: b.density_notes ?? '',
  notes: b.notes ?? '',
  is_competition_coffee: b.is_competition_coffee,
});

/** /beans/new and /beans/:id */
export function BeanFormScreen({ id }: { id?: string }) {
  const bean = useQuery({ ...beanQuery(id ?? ''), enabled: Boolean(id) });
  const title = id ? f.editTitle : f.newTitle;

  if (id && bean.isPending) {
    return (
      <>
        <TopBar title={title} backHref="/beans" />
        <div className="center-block">
          <div className="spinner" role="status" aria-label={strings.app.loading} />
        </div>
      </>
    );
  }
  if (id && bean.isError) {
    return (
      <>
        <TopBar title={title} backHref="/beans" />
        <main className="page shell-main">
          <FormError>{errorMessage(bean.error)}</FormError>
        </main>
      </>
    );
  }
  return <BeanForm key={id ?? 'new'} bean={bean.data} />;
}

function BeanForm({ bean }: { bean?: BeanRow }) {
  const qc = useQueryClient();
  const isOwner = useIsOwner();
  const [, navigate] = useLocation();
  const [values, setValues] = useState<Values>(bean ? fromBean(bean) : blank);
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  useRevealFirstError(errors);

  const set = <K extends keyof Values>(key: K) => (value: Values[K]) => setValues((v) => ({ ...v, [key]: value }));

  const save = useMutation({
    mutationFn: (body: BeanInput) =>
      bean ? api<BeanRow>('PUT', `/api/beans/${bean.id}`, body) : api<BeanRow>('POST', '/api/beans', body),
    onSuccess: async () => {
      await invalidateLibrary(qc);
      navigate('/beans');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.field) setErrors({ [err.field]: err.message });
      else setFormError(errorMessage(err));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!values.name.trim()) {
      setErrors({ name: f.nameRequired });
      return;
    }
    setErrors({});
    const { is_competition_coffee, ...text } = values;
    save.mutate({ ...text, ...(isOwner ? { is_competition_coffee } : {}) });
  };

  const days = daysOffRoast(values.roast_date);

  return (
    <>
      <TopBar title={bean ? f.editTitle : f.newTitle} backHref="/beans" />
      <main className="page shell-main">
        <form className="form" onSubmit={submit} noValidate>
          <div className="form-section" style={{ paddingTop: 8 }}>
            <TextField
              label={f.name}
              placeholder={f.namePlaceholder}
              value={values.name}
              onChange={set('name')}
              error={errors.name}
              maxLength={80}
              autoComplete="off"
            />
            <TextField label={f.roaster} value={values.roaster} onChange={set('roaster')} error={errors.roaster} maxLength={80} />
            <TextField
              label={f.origin}
              placeholder={f.originPlaceholder}
              value={values.origin}
              onChange={set('origin')}
              error={errors.origin}
              maxLength={80}
            />
            <div className="field-pair">
              <TextField label={f.variety} value={values.variety} onChange={set('variety')} error={errors.variety} maxLength={80} />
              <TextField
                label={f.process}
                value={values.process}
                onChange={set('process')}
                error={errors.process}
                list="bean-process-options"
                maxLength={60}
              />
            </div>
            <div className="field-pair">
              <TextField
                label={f.roastLevel}
                value={values.roast_level}
                onChange={set('roast_level')}
                error={errors.roast_level}
                list="bean-roast-options"
                maxLength={40}
              />
              <TextField
                label={f.roastDate}
                type="date"
                value={values.roast_date}
                onChange={set('roast_date')}
                error={errors.roast_date}
                hint={days === null ? undefined : s.daysOff(days)}
              />
            </div>
            <div className="field-pair">
              <TextField
                label={f.altitude}
                placeholder={f.altitudePlaceholder}
                value={values.altitude}
                onChange={set('altitude')}
                error={errors.altitude}
                maxLength={40}
              />
              <TextField
                label={f.densityNotes}
                value={values.density_notes}
                onChange={set('density_notes')}
                error={errors.density_notes}
                maxLength={200}
              />
            </div>
            <TextAreaField
              label={f.notes}
              placeholder={f.notesPlaceholder}
              value={values.notes}
              onChange={set('notes')}
              error={errors.notes}
              maxLength={2000}
            />
            <ToggleField
              label={f.competition}
              checked={values.is_competition_coffee}
              onChange={set('is_competition_coffee')}
              disabled={!isOwner}
              hint={isOwner ? f.competitionHint : f.competitionOwnerOnly}
            />
          </div>

          <datalist id="bean-process-options">
            {f.processOptions.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
          <datalist id="bean-roast-options">
            {f.roastOptions.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>

          <div className="save-bar">
            {formError && <FormError>{formError}</FormError>}
            <button type="submit" className="btn block" disabled={save.isPending}>
              {save.isPending ? strings.common.saving : bean ? f.save : f.create}
            </button>
          </div>
        </form>
      </main>
    </>
  );
}
