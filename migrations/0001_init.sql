-- AeroPress Lab (Team Edition): initial schema.
-- Timestamps are INTEGER milliseconds since epoch. IDs are TEXT (nanoid-style).
-- Every table that holds team data carries team_id so multi-team stays possible.

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  champ_name TEXT,
  champ_date TEXT,                              -- YYYY-MM-DD
  comp_coffee_notes TEXT,
  ai_monthly_budget_usd REAL NOT NULL DEFAULT 10,
  pin_hash TEXT NOT NULL,                       -- team PIN, PBKDF2-SHA256
  pin_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_teams_created ON teams (created_at);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id),
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'barista')),
  pin_hash TEXT,                                -- personal PIN. Always set for the owner.
  pin_salt TEXT,                                -- NULL for a barista means "signs in with the team PIN".
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_members_team_created ON members (team_id, created_at);
CREATE UNIQUE INDEX idx_members_active_name ON members (team_id, name COLLATE NOCASE) WHERE active = 1;
CREATE UNIQUE INDEX idx_members_one_owner ON members (team_id) WHERE role = 'owner';

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,              -- SHA-256 of the cookie token
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_member ON sessions (member_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

CREATE TABLE login_attempts (
  member_id TEXT PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,
  failed_count INTEGER NOT NULL DEFAULT 0,
  first_failed_at INTEGER,                      -- start of the current 15-minute failure window
  locked_until INTEGER
);

CREATE TABLE beans (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id),
  name TEXT NOT NULL,
  roaster TEXT,
  origin TEXT,
  variety TEXT,
  process TEXT,
  roast_level TEXT,
  roast_date TEXT,                              -- YYYY-MM-DD
  altitude TEXT,
  density_notes TEXT,
  notes TEXT,
  is_competition_coffee INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES members (id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_beans_team_created ON beans (team_id, created_at);
CREATE INDEX idx_beans_created_by ON beans (created_by);

CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id),
  owner_member_id TEXT NOT NULL REFERENCES members (id),
  code TEXT NOT NULL,                           -- R1, R2... unique per member
  name TEXT,
  parent_id TEXT REFERENCES recipes (id) ON DELETE SET NULL,
  bean_id TEXT REFERENCES beans (id) ON DELETE SET NULL,
  method TEXT NOT NULL DEFAULT 'Inverted' CHECK (method IN ('Inverted', 'Standard')),
  filter TEXT,
  dose_g REAL,
  water_g REAL,
  temp_c REAL,
  grinder TEXT,
  grind_setting TEXT,
  water_recipe TEXT,
  bloom_water_g REAL,
  bloom_ends_s INTEGER,
  agitation TEXT,
  press_starts_s INTEGER,
  press_duration_s INTEGER,
  bypass_g REAL,
  bypass_temp TEXT,
  other_steps TEXT,
  notes TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_recipes_team_created ON recipes (team_id, created_at);
CREATE UNIQUE INDEX idx_recipes_member_code ON recipes (owner_member_id, code);
CREATE INDEX idx_recipes_parent ON recipes (parent_id);
CREATE INDEX idx_recipes_bean ON recipes (bean_id);

CREATE TABLE brews (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id),
  recipe_id TEXT REFERENCES recipes (id) ON DELETE SET NULL,
  member_id TEXT NOT NULL REFERENCES members (id),
  bean_id TEXT REFERENCES beans (id) ON DELETE SET NULL,
  grind_used TEXT,
  total_time_s INTEGER,
  tds_pct REAL,
  beverage_g REAL,
  ey_pct REAL,                                  -- computed server-side
  sweetness REAL,
  acidity REAL,
  body REAL,
  clarity REAL,
  finish REAL,
  overall REAL,
  notes TEXT,
  ai_read TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_brews_team_created ON brews (team_id, created_at);
CREATE INDEX idx_brews_recipe ON brews (recipe_id);
CREATE INDEX idx_brews_member ON brews (member_id);
CREATE INDEX idx_brews_bean ON brews (bean_id);

CREATE TABLE duels (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id),
  recipe_x_id TEXT NOT NULL REFERENCES recipes (id),
  recipe_y_id TEXT NOT NULL REFERENCES recipes (id),
  bean_id TEXT REFERENCES beans (id) ON DELETE SET NULL,
  judge_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'setup'
    CHECK (status IN ('setup', 'pouring', 'judging', 'revealed', 'cancelled')),
  winner_recipe_id TEXT REFERENCES recipes (id),  -- NULL on a draw
  x_votes INTEGER NOT NULL DEFAULT 0,
  y_votes INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  ai_read TEXT,
  rematch_of TEXT REFERENCES duels (id) ON DELETE SET NULL,
  created_by TEXT REFERENCES members (id),
  created_at INTEGER NOT NULL,
  revealed_at INTEGER
);
CREATE INDEX idx_duels_team_created ON duels (team_id, created_at);
CREATE INDEX idx_duels_team_revealed ON duels (team_id, status, revealed_at);
CREATE INDEX idx_duels_recipe_x ON duels (recipe_x_id);
CREATE INDEX idx_duels_recipe_y ON duels (recipe_y_id);
CREATE INDEX idx_duels_bean ON duels (bean_id);
CREATE INDEX idx_duels_winner ON duels (winner_recipe_id);
CREATE INDEX idx_duels_rematch_of ON duels (rematch_of);
CREATE INDEX idx_duels_created_by ON duels (created_by);

-- Which members judge a duel (1 to 3). Votes arrive in duel_votes.
CREATE TABLE duel_judges (
  duel_id TEXT NOT NULL REFERENCES duels (id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members (id),
  PRIMARY KEY (duel_id, member_id)
);
CREATE INDEX idx_duel_judges_member ON duel_judges (member_id);

CREATE TABLE duel_votes (
  duel_id TEXT NOT NULL REFERENCES duels (id) ON DELETE CASCADE,
  judge_member_id TEXT NOT NULL REFERENCES members (id),
  choice TEXT NOT NULL CHECK (choice IN ('x', 'y', 'tie')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (duel_id, judge_member_id)
);
CREATE INDEX idx_duel_votes_judge ON duel_votes (judge_member_id);

CREATE TABLE ai_calls (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id),
  member_id TEXT REFERENCES members (id),
  kind TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_ai_calls_team_created ON ai_calls (team_id, created_at);
CREATE INDEX idx_ai_calls_member ON ai_calls (member_id);

CREATE TABLE readiness_reports (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id),
  member_id TEXT NOT NULL REFERENCES members (id),
  report_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_readiness_team_created ON readiness_reports (team_id, created_at);
CREATE INDEX idx_readiness_member ON readiness_reports (member_id);
