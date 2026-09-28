-- Barista duels: two teammates, each brewing their own recipe, judged blind. Recipe duels leave
-- these NULL. And every judge's scores for each cup, on the brew log's six tasting scores.
ALTER TABLE duels ADD COLUMN barista_x_id TEXT REFERENCES members (id);
ALTER TABLE duels ADD COLUMN barista_y_id TEXT REFERENCES members (id);

CREATE TABLE duel_scores (
  duel_id TEXT NOT NULL REFERENCES duels (id) ON DELETE CASCADE,
  judge_member_id TEXT NOT NULL REFERENCES members (id),
  cup TEXT NOT NULL CHECK (cup IN ('x', 'y')),
  sweetness REAL NOT NULL,
  acidity REAL NOT NULL,
  body REAL NOT NULL,
  clarity REAL NOT NULL,
  finish REAL NOT NULL,
  overall REAL NOT NULL,
  PRIMARY KEY (duel_id, judge_member_id, cup)
);
CREATE INDEX idx_duel_scores_judge ON duel_scores (judge_member_id);
