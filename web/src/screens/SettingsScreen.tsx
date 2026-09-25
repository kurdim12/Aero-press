import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import type { OkResponse } from '../../../shared/types';
import { api, errorMessage } from '../api';
import { PinField } from '../components/Fields';
import { ChevronIcon } from '../components/Icons';
import { Sheet } from '../components/Sheet';
import { TopBar } from '../components/TopBar';
import { clearSessionData, forgetMember, membersQuery, useIsOwner, useMe } from '../session';
import { strings } from '../strings';
import { getThemePref, setThemePref, type ThemePref } from '../theme';

const s = strings.settings;
const PIN_OK = /^\d{4,8}$/;

export function SettingsScreen() {
  const me = useMe();
  const isOwner = useIsOwner();
  const qc = useQueryClient();
  const [theme, setTheme] = useState<ThemePref>(getThemePref);
  const [teamPinOpen, setTeamPinOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const members = useQuery({ ...membersQuery, enabled: isOwner });
  const activeCount = members.data?.members.filter((m) => m.active).length;

  const signOut = useMutation({
    mutationFn: () => api<OkResponse>('POST', '/api/auth/logout'),
    // No navigation here: the sign-in screen shows at any URL, and signing in lands on the Board.
    onSettled: () => {
      forgetMember();
      clearSessionData(qc);
    },
  });

  const pickTheme = (pref: ThemePref) => {
    setTheme(pref);
    setThemePref(pref);
  };

  return (
    <>
      <TopBar title={s.title} backHref="/" hideAvatar />
      <main className="page shell-main">
        <section className="section" style={{ marginTop: 8 }}>
          <span className="eyebrow">{s.you}</span>
          <div className="rows">
            <div className="row">
              <span className="avatar">{me.member.initials}</span>
              <span className="row-main">
                <span className="row-title">{me.member.name}</span>
                <span className="row-sub">{me.team.name}</span>
              </span>
              <span className={`tag ${isOwner ? 'gold' : ''}`}>{isOwner ? strings.common.owner : strings.common.barista}</span>
            </div>
          </div>
        </section>

        <section className="section">
          <span className="eyebrow" id="theme-label">
            {s.theme}
          </span>
          <div className="segmented" role="group" aria-labelledby="theme-label">
            {(
              [
                ['system', s.themeSystem],
                ['light', s.themeLight],
                ['dark', s.themeDark],
              ] as const
            ).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={theme === value} onClick={() => pickTheme(value)}>
                {label}
              </button>
            ))}
          </div>
        </section>

        {isOwner && (
          <section className="section">
            <span className="eyebrow">{s.team}</span>
            <ul className="rows">
              <li>
                <Link href="/settings/members" className="row">
                  <span className="row-main">
                    <span className="row-title">{s.members}</span>
                    {activeCount !== undefined && <span className="row-sub">{s.membersCount(activeCount)}</span>}
                  </span>
                  <span className="row-trail">
                    <ChevronIcon />
                  </span>
                </Link>
              </li>
              <li>
                <button type="button" className="row" onClick={() => setTeamPinOpen(true)}>
                  <span className="row-main">
                    <span className="row-title">{s.changeTeamPin}</span>
                  </span>
                  <span className="row-trail">
                    <ChevronIcon />
                  </span>
                </button>
              </li>
            </ul>
            {notice && (
              <p className="notice" role="status" style={{ marginTop: 12 }}>
                {notice}
              </p>
            )}
          </section>
        )}

        <section className="section">
          <button type="button" className="btn secondary block" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
            {signOut.isPending ? s.signingOut : s.signOut}
          </button>
        </section>
      </main>

      {teamPinOpen && (
        <TeamPinSheet
          onClose={() => setTeamPinOpen(false)}
          onSaved={() => {
            setTeamPinOpen(false);
            setNotice(s.teamPinSaved);
          }}
        />
      )}
    </>
  );
}

function TeamPinSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (value: string) => api<OkResponse>('PUT', '/api/team/pin', { pin: value }),
    onSuccess: onSaved,
    onError: (err) => setError(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!PIN_OK.test(pin)) {
      setError(strings.setup.pinFormat);
      return;
    }
    setError(null);
    save.mutate(pin);
  };

  return (
    <Sheet title={s.changeTeamPin} onClose={onClose}>
      <p className="muted">{s.changeTeamPinBody}</p>
      <form className="form" onSubmit={submit} noValidate>
        <PinField label={s.newTeamPin} hint={strings.setup.teamPinHint} value={pin} onChange={setPin} error={error} autoFocus />
        <button type="submit" className="btn block" disabled={save.isPending}>
          {save.isPending ? strings.common.saving : s.saveTeamPin}
        </button>
      </form>
    </Sheet>
  );
}
