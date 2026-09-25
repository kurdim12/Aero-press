import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { TopBar } from '../components/TopBar';
import { membersQuery, useIsOwner, useMe } from '../session';
import { strings } from '../strings';

const s = strings.board;

export function BoardScreen() {
  const me = useMe();
  const isOwner = useIsOwner();
  const members = useQuery({ ...membersQuery, enabled: isOwner });
  const needsBaristas = isOwner && members.data !== undefined && !members.data.members.some((m) => m.role === 'barista' && m.active);

  return (
    <>
      <TopBar title={s.title} />
      <main className="page shell-main">
        <p className="eyebrow" style={{ marginTop: 8 }}>
          {me.team.name}
        </p>
        <h2 className="hello condensed">{s.greeting(me.member.name)}</h2>

        {needsBaristas && (
          <section className="callout">
            <h2>{s.addTeamTitle}</h2>
            <p className="muted">{s.addTeamBody}</p>
            <Link href="/settings/members" className="btn block">
              {s.addTeamAction}
            </Link>
          </section>
        )}

        <section className="empty">
          <h2>{s.emptyTitle}</h2>
          <p>{s.emptyBody}</p>
        </section>
      </main>
    </>
  );
}
