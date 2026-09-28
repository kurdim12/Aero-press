// Generated from /migrations by scripts/gen-migrations.mjs. Don't edit: run npm run gen:migrations.
export interface Migration {
  name: string;
  queries: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    "name": "0001_init.sql",
    "queries": [
      "CREATE TABLE teams (\n  id TEXT PRIMARY KEY,\n  name TEXT NOT NULL,\n  champ_name TEXT,\n  champ_date TEXT,                              \n  comp_coffee_notes TEXT,\n  ai_monthly_budget_usd REAL NOT NULL DEFAULT 10,\n  pin_hash TEXT NOT NULL,                       \n  pin_salt TEXT NOT NULL,\n  created_at INTEGER NOT NULL\n)",
      "CREATE INDEX idx_teams_created ON teams (created_at)",
      "CREATE TABLE members (\n  id TEXT PRIMARY KEY,\n  team_id TEXT NOT NULL REFERENCES teams (id),\n  name TEXT NOT NULL,\n  role TEXT NOT NULL CHECK (role IN ('owner', 'barista')),\n  pin_hash TEXT,                                \n  pin_salt TEXT,                                \n  active INTEGER NOT NULL DEFAULT 1,\n  created_at INTEGER NOT NULL\n)",
      "CREATE INDEX idx_members_team_created ON members (team_id, created_at)",
      "CREATE UNIQUE INDEX idx_members_active_name ON members (team_id, name COLLATE NOCASE) WHERE active = 1",
      "CREATE UNIQUE INDEX idx_members_one_owner ON members (team_id) WHERE role = 'owner'",
      "CREATE TABLE sessions (\n  id TEXT PRIMARY KEY,\n  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,\n  token_hash TEXT NOT NULL UNIQUE,              \n  expires_at INTEGER NOT NULL,\n  created_at INTEGER NOT NULL\n)",
      "CREATE INDEX idx_sessions_member ON sessions (member_id)",
      "CREATE INDEX idx_sessions_expires ON sessions (expires_at)",
      "CREATE TABLE login_attempts (\n  member_id TEXT PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,\n  failed_count INTEGER NOT NULL DEFAULT 0,\n  first_failed_at INTEGER,                      \n  locked_until INTEGER\n)",
      "CREATE TABLE beans (\n  id TEXT PRIMARY KEY,\n  team_id TEXT NOT NULL REFERENCES teams (id),\n  name TEXT NOT NULL,\n  roaster TEXT,\n  origin TEXT,\n  variety TEXT,\n  process TEXT,\n  roast_level TEXT,\n  roast_date TEXT,                              \n  altitude TEXT,\n  density_notes TEXT,\n  notes TEXT,\n  is_competition_coffee INTEGER NOT NULL DEFAULT 0,\n  created_by TEXT REFERENCES members (id),\n  created_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL\n)",
      "CREATE INDEX idx_beans_team_created ON beans (team_id, created_at)",
      "CREATE INDEX idx_beans_created_by ON beans (created_by)",
      "CREATE TABLE recipes (\n  id TEXT PRIMARY KEY,\n  team_id TEXT NOT NULL REFERENCES teams (id),\n  owner_member_id TEXT NOT NULL REFERENCES members (id),\n  code TEXT NOT NULL,                           \n  name TEXT,\n  parent_id TEXT REFERENCES recipes (id) ON DELETE SET NULL,\n  bean_id TEXT REFERENCES beans (id) ON DELETE SET NULL,\n  method TEXT NOT NULL DEFAULT 'Inverted' CHECK (method IN ('Inverted', 'Standard')),\n  filter TEXT,\n  dose_g REAL,\n  water_g REAL,\n  temp_c REAL,\n  grinder TEXT,\n  grind_setting TEXT,\n  water_recipe TEXT,\n  bloom_water_g REAL,\n  bloom_ends_s INTEGER,\n  agitation TEXT,\n  press_starts_s INTEGER,\n  press_duration_s INTEGER,\n  bypass_g REAL,\n  bypass_temp TEXT,\n  other_steps TEXT,\n  notes TEXT,\n  locked INTEGER NOT NULL DEFAULT 0,\n  created_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL\n)",
      "CREATE INDEX idx_recipes_team_created ON recipes (team_id, created_at)",
      "CREATE UNIQUE INDEX idx_recipes_member_code ON recipes (owner_member_id, code)",
      "CREATE INDEX idx_recipes_parent ON recipes (parent_id)",
      "CREATE INDEX idx_recipes_bean ON recipes (bean_id)",
      "CREATE TABLE brews (\n  id TEXT PRIMARY KEY,\n  team_id TEXT NOT NULL REFERENCES teams (id),\n  recipe_id TEXT REFERENCES recipes (id) ON DELETE SET NULL,\n  member_id TEXT NOT NULL REFERENCES members (id),\n  bean_id TEXT REFERENCES beans (id) ON DELETE SET NULL,\n  grind_used TEXT,\n  total_time_s INTEGER,\n  tds_pct REAL,\n  beverage_g REAL,\n  ey_pct REAL,                                  \n  sweetness REAL,\n  acidity REAL,\n  body REAL,\n  clarity REAL,\n  finish REAL,\n  overall REAL,\n  notes TEXT,\n  ai_read TEXT,\n  created_at INTEGER NOT NULL\n)",
      "CREATE INDEX idx_brews_team_created ON brews (team_id, created_at)",
      "CREATE INDEX idx_brews_recipe ON brews (recipe_id)",
      "CREATE INDEX idx_brews_member ON brews (member_id)",
      "CREATE INDEX idx_brews_bean ON brews (bean_id)",
      "CREATE TABLE duels (\n  id TEXT PRIMARY KEY,\n  team_id TEXT NOT NULL REFERENCES teams (id),\n  recipe_x_id TEXT NOT NULL REFERENCES recipes (id),\n  recipe_y_id TEXT NOT NULL REFERENCES recipes (id),\n  bean_id TEXT REFERENCES beans (id) ON DELETE SET NULL,\n  judge_count INTEGER NOT NULL DEFAULT 0,\n  status TEXT NOT NULL DEFAULT 'setup'\n    CHECK (status IN ('setup', 'pouring', 'judging', 'revealed', 'cancelled')),\n  winner_recipe_id TEXT REFERENCES recipes (id),  \n  x_votes INTEGER NOT NULL DEFAULT 0,\n  y_votes INTEGER NOT NULL DEFAULT 0,\n  notes TEXT,\n  ai_read TEXT,\n  rematch_of TEXT REFERENCES duels (id) ON DELETE SET NULL,\n  created_by TEXT REFERENCES members (id),\n  created_at INTEGER NOT NULL,\n  revealed_at INTEGER\n)",
      "CREATE INDEX idx_duels_team_created ON duels (team_id, created_at)",
      "CREATE INDEX idx_duels_team_revealed ON duels (team_id, status, revealed_at)",
      "CREATE INDEX idx_duels_recipe_x ON duels (recipe_x_id)",
      "CREATE INDEX idx_duels_recipe_y ON duels (recipe_y_id)",
      "CREATE INDEX idx_duels_bean ON duels (bean_id)",
      "CREATE INDEX idx_duels_winner ON duels (winner_recipe_id)",
      "CREATE INDEX idx_duels_rematch_of ON duels (rematch_of)",
      "CREATE INDEX idx_duels_created_by ON duels (created_by)",
      "CREATE TABLE duel_judges (\n  duel_id TEXT NOT NULL REFERENCES duels (id) ON DELETE CASCADE,\n  member_id TEXT NOT NULL REFERENCES members (id),\n  PRIMARY KEY (duel_id, member_id)\n)",
      "CREATE INDEX idx_duel_judges_member ON duel_judges (member_id)",
      "CREATE TABLE duel_votes (\n  duel_id TEXT NOT NULL REFERENCES duels (id) ON DELETE CASCADE,\n  judge_member_id TEXT NOT NULL REFERENCES members (id),\n  choice TEXT NOT NULL CHECK (choice IN ('x', 'y', 'tie')),\n  created_at INTEGER NOT NULL,\n  PRIMARY KEY (duel_id, judge_member_id)\n)",
      "CREATE INDEX idx_duel_votes_judge ON duel_votes (judge_member_id)",
      "CREATE TABLE ai_calls (\n  id TEXT PRIMARY KEY,\n  team_id TEXT NOT NULL REFERENCES teams (id),\n  member_id TEXT REFERENCES members (id),\n  kind TEXT NOT NULL,\n  model TEXT NOT NULL,\n  input_tokens INTEGER NOT NULL DEFAULT 0,\n  output_tokens INTEGER NOT NULL DEFAULT 0,\n  cost_usd REAL NOT NULL DEFAULT 0,\n  created_at INTEGER NOT NULL\n)",
      "CREATE INDEX idx_ai_calls_team_created ON ai_calls (team_id, created_at)",
      "CREATE INDEX idx_ai_calls_member ON ai_calls (member_id)",
      "CREATE TABLE readiness_reports (\n  id TEXT PRIMARY KEY,\n  team_id TEXT NOT NULL REFERENCES teams (id),\n  member_id TEXT NOT NULL REFERENCES members (id),\n  report_json TEXT NOT NULL,\n  created_at INTEGER NOT NULL\n)",
      "CREATE INDEX idx_readiness_team_created ON readiness_reports (team_id, created_at)",
      "CREATE INDEX idx_readiness_member ON readiness_reports (member_id)"
    ]
  },
  {
    "name": "0002_coach_cache.sql",
    "queries": [
      "CREATE TABLE coach_cache (\n  team_id TEXT NOT NULL REFERENCES teams (id),\n  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,\n  kind TEXT NOT NULL,\n  day TEXT NOT NULL,                            \n  result_json TEXT NOT NULL,\n  created_at INTEGER NOT NULL,\n  PRIMARY KEY (member_id, kind, day)\n)",
      "CREATE INDEX idx_coach_cache_team_created ON coach_cache (team_id, created_at)"
    ]
  },
  {
    "name": "0003_board_indexes.sql",
    "queries": [
      "CREATE INDEX idx_brews_team_member_created ON brews (team_id, member_id, created_at)",
      "CREATE INDEX idx_brews_recipe_created ON brews (recipe_id, created_at)"
    ]
  },
  {
    "name": "0004_ai_models.sql",
    "queries": [
      "ALTER TABLE teams ADD COLUMN ai_coach_model TEXT",
      "ALTER TABLE teams ADD COLUMN ai_quick_model TEXT"
    ]
  },
  {
    "name": "0005_ai_tips.sql",
    "queries": [
      "CREATE TABLE ai_tips (\n  id TEXT PRIMARY KEY,                          \n  team_id TEXT NOT NULL REFERENCES teams (id),\n  subject TEXT NOT NULL CHECK (subject IN ('bean', 'recipe')),\n  subject_id TEXT NOT NULL,\n  tips_json TEXT,                               \n  tips_at INTEGER,\n  member_id TEXT,                               \n  claim TEXT,                                   \n  created_at INTEGER NOT NULL\n)",
      "CREATE INDEX idx_ai_tips_team ON ai_tips (team_id, id)",
      "ALTER TABLE teams ADD COLUMN ai_auto_tips INTEGER NOT NULL DEFAULT 1"
    ]
  },
  {
    "name": "0006_ai_reads.sql",
    "queries": [
      "-- Coach explanations the team keeps: two recipes compared (ours or World champions'), and a\n-- champion recipe broken down. The latest one per subject, written once and updated on request.\nCREATE TABLE ai_reads (\n  team_id TEXT NOT NULL REFERENCES teams (id),\n  id TEXT NOT NULL,                             -- 'compare:<ref>|<ref>' (refs sorted) or 'champion:<id>'\n  kind TEXT NOT NULL,                           -- 'compare' or 'champion'\n  result_json TEXT,                             -- NULL until the first one is written\n  result_at INTEGER,\n  member_id TEXT,                               -- who asked for the latest one\n  claim TEXT,                                   -- 'pending:<ms>' while a phone is writing it\n  created_at INTEGER NOT NULL,\n  PRIMARY KEY (team_id, id)\n);\n"
    ]
  },
  {
    "name": "0007_barista_duels.sql",
    "queries": [
      "ALTER TABLE duels ADD COLUMN barista_x_id TEXT REFERENCES members (id)",
      "ALTER TABLE duels ADD COLUMN barista_y_id TEXT REFERENCES members (id)",
      "CREATE TABLE duel_scores (\n  duel_id TEXT NOT NULL REFERENCES duels (id) ON DELETE CASCADE,\n  judge_member_id TEXT NOT NULL REFERENCES members (id),\n  cup TEXT NOT NULL CHECK (cup IN ('x', 'y')),\n  sweetness REAL NOT NULL,\n  acidity REAL NOT NULL,\n  body REAL NOT NULL,\n  clarity REAL NOT NULL,\n  finish REAL NOT NULL,\n  overall REAL NOT NULL,\n  PRIMARY KEY (duel_id, judge_member_id, cup)\n)",
      "CREATE INDEX idx_duel_scores_judge ON duel_scores (judge_member_id)"
    ]
  }
];
