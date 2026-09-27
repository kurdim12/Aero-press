-- The coach's tips on one bean or one recipe (the latest set), and the owner's switch for writing
-- them automatically when a bean or recipe is added.
CREATE TABLE ai_tips (
  id TEXT PRIMARY KEY,                          -- '<subject>:<subject id>', one row per bean or recipe
  team_id TEXT NOT NULL REFERENCES teams (id),
  subject TEXT NOT NULL CHECK (subject IN ('bean', 'recipe')),
  subject_id TEXT NOT NULL,
  tips_json TEXT,                               -- NULL until the first tips are written
  tips_at INTEGER,
  member_id TEXT,                               -- who asked for the latest tips
  claim TEXT,                                   -- 'pending:<ms>' while a phone is writing new tips
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_ai_tips_team ON ai_tips (team_id, id);

ALTER TABLE teams ADD COLUMN ai_auto_tips INTEGER NOT NULL DEFAULT 1;
