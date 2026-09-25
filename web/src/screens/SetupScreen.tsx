import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import type { MeResponse } from '../../../shared/types';
import type { SetupInput } from '../../../shared/schemas';
import { ApiError, api, errorMessage } from '../api';
import { FormError, PinField, TextField } from '../components/Fields';
import { LogoMark } from '../components/Icons';
import { meQuery, rememberMember, setupStatusQuery } from '../session';
import { strings } from '../strings';

const s = strings.setup;
const PIN_OK = /^\d{4,8}$/;

type Errors = Partial<Record<'team_name' | 'owner_name' | 'owner_pin' | 'owner_pin2' | 'team_pin' | 'team_pin2', string>>;

export function SetupScreen() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [teamName, setTeamName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPin, setOwnerPin] = useState('');
  const [ownerPin2, setOwnerPin2] = useState('');
  const [teamPin, setTeamPin] = useState('');
  const [teamPin2, setTeamPin2] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (input: SetupInput) => api<MeResponse>('POST', '/api/setup', input),
    onSuccess: (me) => {
      rememberMember(me.member.id);
      navigate('/', { replace: true });
      qc.setQueryData(setupStatusQuery.queryKey, { needs_setup: false });
      qc.setQueryData(meQuery.queryKey, me);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'already_set_up') {
        void qc.invalidateQueries({ queryKey: setupStatusQuery.queryKey });
      }
      if (err instanceof ApiError && err.field) setErrors({ [err.field]: err.message });
      else setFormError(errorMessage(err));
    },
  });

  function validate(): Errors {
    const e: Errors = {};
    if (!teamName.trim()) e.team_name = s.teamNameRequired;
    if (!ownerName.trim()) e.owner_name = s.ownerNameRequired;
    if (!PIN_OK.test(ownerPin)) e.owner_pin = s.pinFormat;
    else if (ownerPin2 !== ownerPin) e.owner_pin2 = s.ownerPinMismatch;
    if (!PIN_OK.test(teamPin)) e.team_pin = s.pinFormat;
    else if (teamPin === ownerPin) e.team_pin = s.pinsMustDiffer;
    else if (teamPin2 !== teamPin) e.team_pin2 = s.teamPinMismatch;
    return e;
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    create.mutate({ team_name: teamName, owner_name: ownerName, owner_pin: ownerPin, team_pin: teamPin });
  }

  return (
    <main className="auth page">
      <div className="wordmark condensed">
        <LogoMark />
        {strings.app.name}
      </div>
      <h1 className="auth-title condensed">{s.title}</h1>
      <p className="auth-sub lead">{s.intro}</p>

      <form className="form section" onSubmit={submit} noValidate>
        <TextField
          label={s.teamName}
          placeholder={s.teamNamePlaceholder}
          value={teamName}
          onChange={setTeamName}
          error={errors.team_name}
          autoComplete="organization"
          maxLength={60}
        />
        <TextField
          label={s.ownerName}
          placeholder={s.ownerNamePlaceholder}
          value={ownerName}
          onChange={setOwnerName}
          error={errors.owner_name}
          autoComplete="name"
          maxLength={40}
        />
        <PinField label={s.ownerPin} hint={s.ownerPinHint} value={ownerPin} onChange={setOwnerPin} error={errors.owner_pin} />
        <PinField label={s.ownerPinRepeat} value={ownerPin2} onChange={setOwnerPin2} error={errors.owner_pin2} />
        <PinField label={s.teamPin} hint={s.teamPinHint} value={teamPin} onChange={setTeamPin} error={errors.team_pin} />
        <PinField label={s.teamPinRepeat} value={teamPin2} onChange={setTeamPin2} error={errors.team_pin2} />
        {formError && <FormError>{formError}</FormError>}
        <button type="submit" className="btn block" disabled={create.isPending}>
          {create.isPending ? s.submitting : s.submit}
        </button>
      </form>
    </main>
  );
}
