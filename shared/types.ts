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

// ---------- Duels ----------

export const DUEL_CHOICES = ['x', 'y', 'tie'] as const;
export type DuelChoice = (typeof DUEL_CHOICES)[number];
export type DuelStatus = 'setup' | 'pouring' | 'judging' | 'revealed' | 'cancelled';

/** A recipe in a duel. Judges and onlookers only get these after the reveal. */
export interface DuelRecipe {
  id: string;
  display_code: string;
  name: string | null;
}

export interface DuelPerson {
  id: string;
  name: string;
  initials: string;
}

export interface DuelJudge extends DuelPerson {
  voted: boolean;
  /** How they voted: only after the reveal. */
  choice: DuelChoice | null;
}

export interface DuelResult {
  x_votes: number;
  y_votes: number;
  ties: number;
  /** null on a draw. */
  winner: 'x' | 'y' | null;
}

/**
 * One duel as the asking member may see it. Before the reveal only the creator, who pours,
 * gets the recipes behind X and Y; judges and onlookers get null. The API enforces this.
 */
export interface DuelView {
  id: string;
  status: DuelStatus;
  bean: { id: string; name: string } | null;
  created_by: DuelPerson | null;
  created_at: number;
  revealed_at: number | null;
  judges: DuelJudge[];
  votes_in: number;
  x: DuelRecipe | null;
  y: DuelRecipe | null;
  result: DuelResult | null;
  rematch_of: string | null;
  /** The rematch started from this duel, so every phone can follow it. */
  rematch_id: string | null;
  notes: string | null;
  /** The coach's read of the result, after the reveal. */
  ai_read: DuelRead | null;
  you: {
    is_creator: boolean;
    is_judge: boolean;
    vote: DuelChoice | null;
    /** Creator or owner: can call the cups ready, reveal early, cancel, rematch. */
    can_manage: boolean;
  };
}

export interface DuelsResponse {
  /** Pouring or judging now. */
  active: DuelView[];
  /** Revealed or cancelled, newest first. */
  recent: DuelView[];
}

// ---------- AI coach ----------

/** Recipe settings an AI experiment changes versus its parent (recipe columns only). */
export type RecipeChanges = Partial<RecipeFields>;

export interface Experiment {
  title: string;
  /** The parent recipe's code as the coach wrote it, and the recipe it matched (if any). */
  parent: string | null;
  parent_id: string | null;
  changes: RecipeChanges;
  why: string;
  listenFor: string;
}

export interface ExperimentsResponse {
  read: string;
  experiments: Experiment[];
}

export const READINESS_VERDICTS = ['ready', 'close', 'not ready'] as const;
export type ReadinessVerdict = (typeof READINESS_VERDICTS)[number];

export interface ReadinessReport {
  id: string;
  member_name: string;
  verdict: ReadinessVerdict;
  biggestRisk: string;
  fixes: string[];
  evidence: string;
  created_at: number;
}

export interface TodayDuel {
  a: string;
  b: string;
  a_id: string | null;
  b_id: string | null;
  why: string;
}

export interface TodaySession {
  /** YYYY-MM-DD in Amman. */
  day: string;
  summary: string;
  duels: TodayDuel[];
  created_at: number;
}

export interface TodayResponse {
  session: TodaySession | null;
  /** True when the team has fewer than two recipes, so there is nothing to duel yet (no AI call). */
  needs_recipes?: boolean;
}

export interface DuelRead {
  read: string;
  next_test: Experiment | null;
}

export interface DuelReadResponse {
  read: DuelRead | null;
  /** Another phone is writing it; ask again in a few seconds. */
  pending: boolean;
}

export interface QuickLogMatch {
  id: string | null;
  confidence: number;
}

/** A quick log turned into brew-log fields. Anything the text didn't say is null. */
export interface QuickLogResponse {
  recipe_id: string | null;
  bean_id: string | null;
  grind_used: string | null;
  total_time_s: number | null;
  tds_pct: number | null;
  beverage_g: number | null;
  sweetness: number | null;
  acidity: number | null;
  body: number | null;
  clarity: number | null;
  finish: number | null;
  overall: number | null;
  notes: string | null;
  recipeMatch: QuickLogMatch;
  beanMatch: QuickLogMatch;
}

export interface AiUsage {
  /** False until the owner adds the Anthropic API key. */
  configured: boolean;
  month_spend_usd: number;
  cap_usd: number;
  calls: number;
}

// ---------- Board (monitoring dashboard) ----------

/** A recipe as the Board shows it: who made it and how it's ranked. */
export interface BoardRecipe {
  id: string;
  display_code: string;
  name: string | null;
  owner_name: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  duels: number;
}

export interface LeaderboardEntry {
  member_id: string;
  name: string;
  initials: string;
  /** Their highest-rated recipe with at least one duel. */
  recipe: BoardRecipe | null;
}

export interface EloSeries {
  recipe: BoardRecipe;
  /** Elo after each duel, oldest first. */
  points: { t: number; elo: number }[];
}

export interface WeeklyScore {
  /** Monday of the week, YYYY-MM-DD. */
  week: string;
  avg_overall: number;
  brews: number;
}

export interface ConsistencyRow {
  recipe: BoardRecipe;
  brews: number;
  tds_sd: number | null;
  overall_sd: number | null;
  unreliable: boolean;
}

export interface VolumeMember {
  member_id: string;
  name: string;
  initials: string;
  /** One count per day in `volume.days`. */
  brews: number[];
  duels: number[];
  /** Last brew or duel, and whole days since then. */
  last_active: number | null;
  days_since: number | null;
}

export const READINESS_KEYS = ['locked', 'wins', 'beans', 'timed', 'comp_duel'] as const;
export type ReadinessKey = (typeof READINESS_KEYS)[number];

export interface ReadinessItem {
  key: ReadinessKey;
  done: boolean;
  value: number;
  target: number;
  /** False when it can't be checked yet (no competition coffee marked). */
  applicable: boolean;
}

export interface BoardResponse {
  /** null member = the whole team (owner); otherwise one member's own numbers. */
  view: { member_id: string | null; name: string | null };
  champ: { name: string | null; date: string | null; days_left: number | null };
  comp_coffee: { id: string; name: string } | null;
  locked_recipe: BoardRecipe | null;
  top_recipe: BoardRecipe | null;
  leaderboard: LeaderboardEntry[];
  elo_series: EloSeries[];
  weekly: WeeklyScore[];
  consistency: ConsistencyRow[];
  volume: { days: string[]; members: VolumeMember[] };
  readiness: ReadinessItem[];
  ai: AiUsage;
}

/** The team's settings, as Settings shows them (everyone reads; the owner changes them). */
export interface TeamSettings {
  name: string;
  champ_name: string | null;
  champ_date: string | null;
  comp_coffee_notes: string | null;
  ai_monthly_budget_usd: number;
}

/** Backup parts, one table each, so no single request builds the whole file. */
export const EXPORT_PARTS = [
  'team',
  'members',
  'beans',
  'recipes',
  'brews',
  'duels',
  'duel_judges',
  'duel_votes',
  'readiness_reports',
  'ai_calls',
] as const;
export type ExportPart = (typeof EXPORT_PARTS)[number];
/** Rows per backup page (duel-owned tables: duels per page). */
export const EXPORT_PAGE = 500;

/** One page of one table of the owner's backup (GET /api/export). */
export interface ExportPage {
  part: ExportPart;
  rows: Record<string, unknown>[];
  /** Pass as `after` for the next page; null when this was the last. */
  next: string | null;
}
