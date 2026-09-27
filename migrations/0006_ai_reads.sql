-- Coach explanations the team keeps: two recipes compared (ours or World champions'), and a
-- champion recipe broken down. The latest one per subject, written once and updated on request.
CREATE TABLE ai_reads (
  team_id TEXT NOT NULL REFERENCES teams (id),
  id TEXT NOT NULL,                             -- 'compare:<ref>|<ref>' (refs sorted) or 'champion:<id>'
  kind TEXT NOT NULL,                           -- 'compare' or 'champion'
  result_json TEXT,                             -- NULL until the first one is written
  result_at INTEGER,
  member_id TEXT,                               -- who asked for the latest one
  claim TEXT,                                   -- 'pending:<ms>' while a phone is writing it
  created_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, id)
);
