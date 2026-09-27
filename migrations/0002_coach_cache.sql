-- Coach results kept for the day, one per member and kind (today's session card).
CREATE TABLE coach_cache (
  team_id TEXT NOT NULL REFERENCES teams (id),
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  day TEXT NOT NULL,                            -- YYYY-MM-DD, Amman time
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (member_id, kind, day)
);
CREATE INDEX idx_coach_cache_team_created ON coach_cache (team_id, created_at);
