import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import type { TeamSettings } from '../../../shared/types';
import type { TeamSettingsInput } from '../../../shared/schemas';
import { aiUsageQuery } from '../ai';
import { ApiError, api, errorMessage } from '../api';
import { teamSettingsQuery } from '../board';
import { FormError, NumberField, TextAreaField, TextField, useRevealFirstError } from '../components/Fields';
import { TopBar } from '../components/TopBar';
import { setFlash } from '../flash';
import { parseNumber } from '../format';
import { strings } from '../strings';

const t = strings.teamSettings;

/** /settings/team (owner): team name, championship, competition coffee notes, AI budget. */
export function TeamSettingsScreen() {
  const settings = useQuery(teamSettingsQuery);
  return (
    <>
      <TopBar title={t.title} backHref="/settings" hideAvatar />
      <main className="page shell-main">
        {settings.data ? (
          <TeamSettingsForm initial={settings.data} />
        ) : settings.isError ? (
          <div className="section">
            <FormError>{errorMessage(settings.error)}</FormError>
          </div>
        ) : (
          <div className="center-block">
            <div className="spinner" role="status" aria-label={strings.app.loading} />
          </div>
        )}
      </main>
    </>
  );
}

type Errors = Partial<Record<keyof TeamSettings, string>>;

function TeamSettingsForm({ initial }: { initial: TeamSettings }) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const usage = useQuery(aiUsageQuery);
  const [name, setName] = useState(initial.name);
  const [champName, setChampName] = useState(initial.champ_name ?? '');
  const [champDate, setChampDate] = useState(initial.champ_date ?? '');
  const [notes, setNotes] = useState(initial.comp_coffee_notes ?? '');
  const [budget, setBudget] = useState(String(initial.ai_monthly_budget_usd));
  const [errors, setErrors] = useState<Errors>({});
  useRevealFirstError(errors);

  const save = useMutation({
    mutationFn: (body: TeamSettingsInput) => api<TeamSettings>('PUT', '/api/team', body),
    onSuccess: (saved) => {
      qc.setQueryData(teamSettingsQuery.queryKey, saved);
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['ai-usage'] });
      void qc.invalidateQueries({ queryKey: ['board'] });
      setFlash(t.saved);
      navigate('/settings');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.field) setErrors({ [err.field]: errorMessage(err) });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const amount = parseNumber(budget);
    const next: Errors = {};
    if (!name.trim()) next.name = strings.setup.teamNameRequired;
    if (amount === null || amount === 'invalid' || amount < 0) next.ai_monthly_budget_usd = t.budgetInvalid;
    setErrors(next);
    if (Object.keys(next).length > 0 || typeof amount !== 'number') return;
    save.mutate({
      name: name.trim(),
      champ_name: champName,
      champ_date: champDate,
      comp_coffee_notes: notes,
      ai_monthly_budget_usd: amount,
    });
  };

  const spent = usage.data ? strings.coach.money(usage.data.month_spend_usd) : '…';
  return (
    <form className="form section" style={{ marginTop: 8 }} onSubmit={submit} noValidate>
      <TextField label={t.name} value={name} onChange={setName} maxLength={60} error={errors.name} />
      <TextField label={t.champName} placeholder={t.champNamePlaceholder} value={champName} onChange={setChampName} maxLength={120} error={errors.champ_name} />
      <TextField label={t.champDate} type="date" hint={t.champDateHint} value={champDate} onChange={setChampDate} error={errors.champ_date} />
      <TextAreaField label={t.compNotes} placeholder={t.compNotesPlaceholder} value={notes} onChange={setNotes} maxLength={2000} error={errors.comp_coffee_notes} />
      <NumberField
        label={t.budget}
        unit="$"
        hint={t.budgetHint(spent)}
        value={budget}
        onChange={setBudget}
        error={errors.ai_monthly_budget_usd}
      />
      {save.isError && !(save.error instanceof ApiError && save.error.field) && <FormError>{errorMessage(save.error)}</FormError>}
      <button type="submit" className="btn block" disabled={save.isPending}>
        {save.isPending ? strings.common.saving : t.save}
      </button>
    </form>
  );
}
