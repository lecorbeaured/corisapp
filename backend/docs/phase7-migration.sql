-- Phase 7 Migration: users auth columns
-- Run once in your database before using Phase 7 auth routes.

ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS email text UNIQUE,
  ADD COLUMN IF NOT EXISTS password_hash text;

-- Optional: backfill or enforce NOT NULL after you have data
-- ALTER TABLE users ALTER COLUMN email SET NOT NULL;
-- ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
