import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import type { MeResponse, PinType, SignInMember } from '../../../shared/types';
import { ApiError, api, errorMessage } from '../api';
import { FormError } from '../components/Fields';
import { BackIcon, ChevronIcon, LogoMark } from '../components/Icons';
import { PinPad } from '../components/PinPad';
import { forgetMember, lastMember, meQuery, rememberMember, signInListQuery } from '../session';
import { strings } from '../strings';

const s = strings.signIn;

export function SignInScreen() {
  const list = useQuery(signInListQuery);
  const [pickedId, setPickedId] = useState<string | null>(() => lastMember());

  if (list.isPending) {
    return (
      <div className="center-screen">
        <div className="spinner" aria-label={strings.app.loading} />
      </div>
    );
  }
  if (list.isError) {
    return (
      <main className="auth page">
        <Brand />
        <div className="section">
          <FormError>{errorMessage(list.error)}</FormError>
          <button type="button" className="btn secondary block section" onClick={() => void list.refetch()}>
            {strings.common.retry}
          </button>
        </div>
      </main>
    );
  }

  const picked = list.data.members.find((m) => m.id === pickedId);
  if (picked) {
    return (
      <PinEntry
        member={picked}
        onBack={() => {
          forgetMember();
          setPickedId(null);
        }}
      />
    );
  }

  return (
    <main className="auth page">
      <Brand teamName={list.data.team_name} />
      <h1 className="auth-title condensed">{s.whoIsBrewing}</h1>
      <p className="auth-sub lead">{s.pickName}</p>
      {list.data.members.length === 0 ? (
        <p className="section muted">{s.noMembers}</p>
      ) : (
        <ul className="rows section">
          {list.data.members.map((m) => (
            <li key={m.id}>
              <button type="button" className="row" onClick={() => setPickedId(m.id)}>
                <span className="avatar">{m.initials}</span>
                <span className="row-main">
                  <span className="row-title">{m.name}</span>
                </span>
                <span className="row-trail">
                  {m.role === 'owner' && <span className="tag gold">{strings.common.owner}</span>}
                  <ChevronIcon />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function Brand({ teamName }: { teamName?: string }) {
  return (
    <div className="wordmark condensed">
      <LogoMark />
      <span>
        {strings.app.name}
        {teamName && (
          <span className="muted" style={{ display: 'block', fontSize: 15, marginTop: 4, fontStretch: '100%', fontWeight: 600, textTransform: 'none' }}>
            {teamName}
          </span>
        )}
      </span>
    </div>
  );
}

const PROMPT: Record<PinType, string> = {
  owner: s.enterOwnerPin,
  personal: s.enterPersonalPin,
  team: s.enterTeamPin,
};

function PinEntry({ member, onBack }: { member: SignInMember; onBack: () => void }) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);

  const signIn = useMutation({
    mutationFn: (value: string) => api<MeResponse>('POST', '/api/auth/login', { member_id: member.id, pin: value }),
    onSuccess: (me) => {
      rememberMember(member.id);
      // Everyone starts on the Board, whatever page the last person left open.
      navigate('/', { replace: true });
      qc.setQueryData(meQuery.queryKey, me);
    },
    onError: (err) => {
      setPin('');
      setError(errorMessage(err));
      setShakeKey((k) => k + 1);
      navigator.vibrate?.(120);
      if (err instanceof ApiError && err.code === 'member_not_found') {
        void qc.invalidateQueries({ queryKey: signInListQuery.queryKey });
      }
    },
  });

  const submit = () => {
    if (pin.length < 4 || signIn.isPending) return;
    setError(null);
    signIn.mutate(pin);
  };

  return (
    <main className="auth page">
      <button type="button" className="btn ghost" onClick={onBack} style={{ marginLeft: -12 }}>
        <BackIcon width={20} height={20} />
        {s.notYou}
      </button>
      <div className="pin-screen">
        <span className="avatar lg">{member.initials}</span>
        <h1 className="pin-who condensed">{s.hi(member.name)}</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          {PROMPT[member.pin_type]}
        </p>
        <PinPad
          value={pin}
          onChange={(value) => {
            setPin(value);
            if (value) setError(null);
          }}
          onSubmit={submit}
          disabled={signIn.isPending}
          shakeKey={shakeKey}
          error={error}
        />
        <div className="pin-actions">
          <button type="button" className="btn block" onClick={submit} disabled={pin.length < 4 || signIn.isPending}>
            {signIn.isPending ? s.submitting : s.submit}
          </button>
        </div>
      </div>
    </main>
  );
}
