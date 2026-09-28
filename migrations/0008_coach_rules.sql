-- The owner's house rules for the coach: equipment limits, water, preferences. Every coach call
-- gets them as rules it must follow (NULL = none).
ALTER TABLE teams ADD COLUMN coach_rules TEXT;
