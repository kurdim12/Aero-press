import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MemberRow, OkResponse } from '../../../shared/types';
import { api, errorMessage } from '../api';
import { ErrorText, FormError, PinField } from '../components/Fields';
import { ChevronIcon } from '../components/Icons';
import { Sheet } from '../components/Sheet';
import { TopBar } from '../components/TopBar';
import { membersQuery, signInListQuery, useMe } from '../session';
import { strings } from '../strings';

const s = strings.members;
const PIN_OK = /^\d{4,8}$/;

const firstName = (name: string) => name.split(' ')[0] ?? name;

function statusLine(m: MemberRow): string {
  if (!m.active) return s.inactive;
  if (m.locked_until) return s.lockedFor(Math.max(1, Math.ceil((m.locked_until - Date.now()) / 60_000)));
  const role = m.role === 'owner' ? strings.common.owner : strings.common.barista;
  return m.pin_type ? `${role} · ${s.signsInWith[m.pin_type]}` : role;
}

/** Owner only (the router redirects baristas). */
export function MembersScreen() {
  const qc = useQueryClient();
  const members = useQuery(membersQuery);
  const [name, setName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: membersQuery.queryKey });
    void qc.invalidateQueries({ queryKey: signInListQuery.queryKey });
  };

  const add = useMutation({
    mutationFn: (value: string) => api<MemberRow>('POST', '/api/members', { name: value }),
    onSuccess: (member) => {
      setName('');
      setNotice(s.added(member.name));
      refresh();
    },
    onError: (err) => setAddError(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!name.trim()) {
      setAddError(s.nameRequired);
      return;
    }
    setAddError(null);
    add.mutate(name.trim());
  };

  const open = members.data?.members.find((m) => m.id === openId);

  return (
    <>
      <TopBar title={s.title} backHref="/settings" hideAvatar />
      <main className="page shell-main">
        <section className="section" style={{ marginTop: 8 }}>
          <form onSubmit={submit} noValidate>
            <label className="field-label" htmlFor="new-member">
              {s.addTitle}
            </label>
            <div className="inline-form" style={{ marginTop: 6 }}>
              <input
                id="new-member"
                className="input"
                placeholder={s.addNamePlaceholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                autoComplete="off"
                aria-invalid={addError ? true : undefined}
              />
              <button type="submit" className="btn" disabled={add.isPending}>
                {s.addSubmit}
              </button>
            </div>
            {addError && (
              <div style={{ marginTop: 8 }}>
                <ErrorText>{addError}</ErrorText>
              </div>
            )}
          </form>
          {notice && (
            <p className="notice" role="status" style={{ marginTop: 12 }}>
              {notice}
            </p>
          )}
        </section>

        <section className="section">
          {members.isError && <FormError>{errorMessage(members.error)}</FormError>}
          <ul className="rows">
            {members.data?.members.map((m) => (
              <li key={m.id}>
                <button type="button" className="row" onClick={() => setOpenId(m.id)}>
                  <span className={`avatar${m.active ? '' : ' muted-avatar'}`}>{m.initials}</span>
                  <span className="row-main">
                    <span className="row-title">{m.name}</span>
                    <span className="row-sub">{statusLine(m)}</span>
                  </span>
                  <span className="row-trail">
                    {m.role === 'owner' && <span className="tag gold">{strings.common.owner}</span>}
                    {m.locked_until && <span className="tag warn">{s.locked}</span>}
                    <ChevronIcon />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>

      {open && (
        <MemberSheet
          member={open}
          onClose={() => setOpenId(null)}
          onDone={(message) => {
            refresh();
            setNotice(message);
            setOpenId(null);
          }}
        />
      )}
    </>
  );
}

function MemberSheet({ member, onClose, onDone }: { member: MemberRow; onClose: () => void; onDone: (message: string) => void }) {
  const me = useMe();
  const isOwnerRow = member.role === 'owner';
  const isSelf = member.id === me.member.id;
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  const savePin = useMutation({
    mutationFn: (value: string) => api<OkResponse>('PUT', `/api/members/${member.id}/pin`, { pin: value }),
    onSuccess: () => onDone(s.sheet.pinSaved),
    onError: (err) => setPinError(errorMessage(err)),
  });
  const backToTeamPin = useMutation({
    mutationFn: () => api<OkResponse>('DELETE', `/api/members/${member.id}/pin`),
    onSuccess: () => onDone(s.sheet.usingTeamPin),
  });
  const setActive = useMutation({
    mutationFn: (active: boolean) => api<OkResponse>('PATCH', `/api/members/${member.id}`, { active }),
    onSuccess: (_, active) => onDone(active ? s.sheet.reactivated(member.name) : s.sheet.deactivated(member.name)),
  });

  const submitPin = (e: FormEvent) => {
    e.preventDefault();
    if (!PIN_OK.test(pin)) {
      setPinError(strings.setup.pinFormat);
      return;
    }
    setPinError(null);
    savePin.mutate(pin);
  };

  const otherError = backToTeamPin.error ?? setActive.error;

  return (
    <Sheet title={member.name} onClose={onClose}>
      <div className="row plain">
        <span className={`avatar${member.active ? '' : ' muted-avatar'}`}>{member.initials}</span>
        <span className="row-main">
          <span className="row-sub">{s.sheet.signsInWith}</span>
          <span className="row-title">{member.pin_type ? s.signsInWith[member.pin_type] : '—'}</span>
        </span>
        {isOwnerRow ? (
          <span className="tag gold">{strings.common.owner}</span>
        ) : (
          <span className={`tag ${member.active ? 'accent' : ''}`}>{member.active ? s.active : s.inactive}</span>
        )}
      </div>

      {member.locked_until && <p className="form-error">{statusLine(member)}</p>}

      {member.active && (
        <section className="sheet-block">
          <h3>{isOwnerRow ? s.sheet.changeOwnerPin : s.sheet.resetPin}</h3>
          <p className="muted small">{isOwnerRow ? s.sheet.changeOwnerPinBody : s.sheet.resetPinBody(firstName(member.name))}</p>
          <form className="form" onSubmit={submitPin} noValidate>
            <PinField label={s.sheet.newPin} value={pin} onChange={setPin} error={pinError} />
            <button type="submit" className="btn block" disabled={savePin.isPending}>
              {savePin.isPending ? strings.common.saving : isOwnerRow ? s.sheet.saveOwnerPin : s.sheet.savePersonalPin}
            </button>
          </form>
        </section>
      )}

      {!isOwnerRow && member.active && member.pin_type === 'personal' && (
        <section className="sheet-block">
          <h3>{s.sheet.useTeamPin}</h3>
          <p className="muted small">{s.sheet.useTeamPinBody}</p>
          <button
            type="button"
            className="btn secondary block"
            onClick={() => backToTeamPin.mutate()}
            disabled={backToTeamPin.isPending}
          >
            {s.sheet.useTeamPin}
          </button>
        </section>
      )}

      {!isOwnerRow && !isSelf && (
        <section className="sheet-block">
          <h3>{member.active ? s.sheet.deactivate : s.sheet.reactivate}</h3>
          <p className="muted small">{member.active ? s.sheet.deactivateBody : s.sheet.reactivateBody}</p>
          <button
            type="button"
            className={`btn block ${member.active ? 'danger' : 'secondary'}`}
            onClick={() => setActive.mutate(!member.active)}
            disabled={setActive.isPending}
          >
            {member.active ? s.sheet.deactivateNamed(firstName(member.name)) : s.sheet.reactivateNamed(firstName(member.name))}
          </button>
        </section>
      )}

      {otherError && <FormError>{errorMessage(otherError)}</FormError>}
    </Sheet>
  );
}
