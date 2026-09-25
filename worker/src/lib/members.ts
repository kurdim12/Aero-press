import type { MeResponse, MemberRow, PinType, Role } from '../../../shared/types';
import { initialsOf } from '../../../shared/initials';
import type { AuthMember } from '../env';
import { notFound } from './errors';

export interface MemberDbRow {
  id: string;
  team_id: string;
  name: string;
  role: Role;
  pin_hash: string | null;
  pin_salt: string | null;
  active: number;
  created_at: number;
}

export function pinTypeOf(row: { role: Role; has_pin: number | boolean }): PinType {
  if (row.role === 'owner') return 'owner';
  return row.has_pin ? 'personal' : 'team';
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && err.message.includes('UNIQUE constraint failed');
}

/** Load a member of the caller's team, or 404. */
export async function getTeamMember(db: D1Database, teamId: string, memberId: string): Promise<MemberDbRow> {
  const row = await db
    .prepare('SELECT * FROM members WHERE id = ? AND team_id = ?')
    .bind(memberId, teamId)
    .first<MemberDbRow>();
  if (!row) throw notFound('member');
  return row;
}

interface AdminRow {
  id: string;
  name: string;
  role: Role;
  active: number;
  created_at: number;
  has_pin: number;
  locked_until: number | null;
}

/** All members for the owner (with sign-in details), or active members for a barista. */
export async function listMembers(db: D1Database, teamId: string, forOwner: boolean): Promise<MemberRow[]> {
  const now = Date.now();
  const { results } = await db
    .prepare(
      `SELECT m.id, m.name, m.role, m.active, m.created_at,
              m.pin_hash IS NOT NULL AS has_pin, la.locked_until
         FROM members m LEFT JOIN login_attempts la ON la.member_id = m.id
        WHERE m.team_id = ? ${forOwner ? '' : 'AND m.active = 1'}
        ORDER BY m.active DESC, m.name COLLATE NOCASE`,
    )
    .bind(teamId)
    .all<AdminRow>();
  return results.map((r) => {
    const base: MemberRow = {
      id: r.id,
      name: r.name,
      role: r.role,
      initials: initialsOf(r.name),
      active: r.active === 1,
      created_at: r.created_at,
    };
    if (!forOwner) return base;
    return {
      ...base,
      pin_type: pinTypeOf(r),
      locked_until: r.locked_until !== null && r.locked_until > now ? r.locked_until : null,
    };
  });
}

export async function meResponse(db: D1Database, member: Pick<AuthMember, 'id' | 'team_id' | 'name' | 'role'>): Promise<MeResponse> {
  const team = await db
    .prepare('SELECT id, name, champ_name, champ_date FROM teams WHERE id = ?')
    .bind(member.team_id)
    .first<MeResponse['team']>();
  if (!team) throw notFound('team');
  return {
    member: { id: member.id, name: member.name, role: member.role, initials: initialsOf(member.name) },
    team,
  };
}
