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

// ---------- Beans ----------

export interface Bean {
  id: string;
  name: string;
  roaster: string | null;
  origin: string | null;
  variety: string | null;
  process: string | null;
  roast_level: string | null;
  /** YYYY-MM-DD */
  roast_date: string | null;
  altitude: string | null;
  density_notes: string | null;
  notes: string | null;
  is_competition_coffee: boolean;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

export interface BeanRow extends Bean {
  brew_count: number;
  recipe_count: number;
}

export interface BeansResponse {
  beans: BeanRow[];
}

// ---------- Recipes ----------

export const METHODS = ['Inverted', 'Standard'] as const;
export type Method = (typeof METHODS)[number];

/** The brew-defining fields, shared by the form, compare view and AI experiments. */
export interface RecipeFields {
  name: string | null;
  bean_id: string | null;
  method: Method;
  filter: string | null;
  dose_g: number | null;
  water_g: number | null;
  temp_c: number | null;
  grinder: string | null;
  grind_setting: string | null;
  water_recipe: string | null;
  bloom_water_g: number | null;
  bloom_ends_s: number | null;
  agitation: string | null;
  press_starts_s: number | null;
  press_duration_s: number | null;
  bypass_g: number | null;
  bypass_temp: string | null;
  other_steps: string | null;
  notes: string | null;
}

export interface Recipe extends RecipeFields {
  id: string;
  owner_member_id: string;
  /** R1, R2… unique per member. */
  code: string;
  parent_id: string | null;
  locked: boolean;
  created_at: number;
  updated_at: number;
}

export interface Standing {
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  duels: number;
}

export interface RecipeRow extends Recipe, Standing {
  /** Code with the owner's initials, e.g. AK-R3. */
  display_code: string;
  owner_name: string;
  owner_initials: string;
  bean_name: string | null;
  parent_display_code: string | null;
  brew_count: number;
}

export interface RecipesResponse {
  recipes: RecipeRow[];
  /** Set when Elo was computed from duels on one bean only. */
  bean_filter: { id: string; name: string } | null;
}

export interface BrewRow {
  id: string;
  recipe_id: string | null;
  member_id: string;
  member_name: string | null;
  member_initials: string;
  bean_id: string | null;
  bean_name: string | null;
  grind_used: string | null;
  total_time_s: number | null;
  tds_pct: number | null;
  beverage_g: number | null;
  ey_pct: number | null;
  sweetness: number | null;
  acidity: number | null;
  body: number | null;
  clarity: number | null;
  finish: number | null;
  overall: number | null;
  notes: string | null;
  ai_read: string | null;
  created_at: number;
}

export interface BrewAverages {
  count: number;
  sweetness: number | null;
  acidity: number | null;
  body: number | null;
  clarity: number | null;
  finish: number | null;
  overall: number | null;
  tds_pct: number | null;
  ey_pct: number | null;
}

export interface RecipeDetailResponse {
  recipe: RecipeRow;
  brews: BrewRow[];
  averages: BrewAverages;
}

// ---------- v1 import ----------

/** Records per import request, so each request stays well inside the Worker's CPU budget. */
export const IMPORT_CHUNK_MAX = 200;

export type ImportKind = 'beans' | 'recipes' | 'brews' | 'duels' | 'settings';

export interface ImportWarning {
  code: string;
  count: number;
  /** Up to five specifics, e.g. "R1 → R8" for a renamed code. */
  examples: string[];
  /** English fallback; the web app words known codes itself. */
  message: string;
}

export interface ImportResult {
  kind: ImportKind;
  inserted: number;
  already_there: number;
  skipped: number;
  warnings: ImportWarning[];
}
