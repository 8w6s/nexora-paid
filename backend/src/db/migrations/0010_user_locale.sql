-- Add per-user locale preference. Defaults to NULL so existing users fall back
-- to Accept-Language detection until they pick one in the UI.
ALTER TABLE users ADD COLUMN locale TEXT;