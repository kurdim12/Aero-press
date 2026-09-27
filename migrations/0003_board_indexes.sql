-- Indexes for the Board, so its per-member and per-recipe lookups read a few rows, not the team's
-- whole brew history (D1's free plan counts every row read).
CREATE INDEX idx_brews_team_member_created ON brews (team_id, member_id, created_at);
CREATE INDEX idx_brews_recipe_created ON brews (recipe_id, created_at);
