// API shapes shared by the Worker and the web app.
// Entity fields use the D1 column names (snake_case) end to end.

export type Role = 'owner' | 'barista';

/** How a member signs in: owner PIN, a personal PIN set by the owner, or the shared team PIN. */
export type PinType = 'owner' | 'personal' | 'team';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    tries_left?: number;
    retry_after_ms?: number;
  };
}

export interface SetupStatus {
  needs_setup: boolean;
}

export interface MeMember {
  id: string;
  name: string;
  role: Role;
  initials: string;
}

export interface MeTeam {
  id: string;
  name: string;
  champ_name: string | null;
  champ_date: string | null;
}

export interface MeResponse {
  member: MeMember;
  team: MeTeam;
}

export interface SignInMember {
  id: string;
  name: string;
  role: Role;
  initials: string;
  pin_type: PinType;
}

export interface SignInList {
  team_name: string;
  members: SignInMember[];
}

/** Member row as the owner sees it in Settings. Baristas get the same shape without admin fields. */
export interface MemberRow {
  id: string;
  name: string;
  role: Role;
  initials: string;
  active: boolean;
  pin_type?: PinType;
  locked_until?: number | null;
  created_at: number;
}

export interface MembersResponse {
  members: MemberRow[];
}

export interface OkResponse {
  ok: true;
}
