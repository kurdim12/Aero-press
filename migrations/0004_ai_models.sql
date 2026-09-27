-- The OpenRouter models the owner picked in Settings (NULL = the default for that role).
ALTER TABLE teams ADD COLUMN ai_coach_model TEXT;
ALTER TABLE teams ADD COLUMN ai_quick_model TEXT;
