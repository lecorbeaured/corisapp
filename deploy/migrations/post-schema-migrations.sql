-- ═══════════════════════════════════════
-- CORIS Database Migration Checklist
-- Run these in order on a fresh PostgreSQL 14+ database.
-- ═══════════════════════════════════════
--
-- CORIS uses a multi-phase SQL schema built across Phases 1–4
-- with additions in Phase 7 (auth) and Phase 12 (password reset).
--
-- This file documents what needs to exist. The actual Phase 1–4
-- schema SQL lives in your original CORIS SQL files.
--
-- ═══════════════════════════════════════
-- PHASE 1–4: Core Schema (run your original schema file)
-- ═══════════════════════════════════════
--
-- Tables created:
--   users
--   bill_templates
--   bill_occurrences
--   pay_schedules
--   paycheck_windows
--   reminders
--
-- Views created:
--   v_bill_occurrences_status
--   v_paycheck_window_totals
--   v_paycheck_window_items
--   v_unassigned_future_unpaid_occurrences
--   v_occurrences_assigned_to_inactive_windows
--
-- Functions created:
--   coris_generate_bill_occurrences_for_user(uuid)
--   coris_generate_paycheck_windows_for_schedule(uuid, int)
--   coris_assign_occurrences_to_active_windows(uuid)
--   coris_cancel_unsent_reminders_for_occurrence(uuid, text)
--   coris_user_today(uuid)
--
-- Triggers:
--   Ledger immutability triggers on bill_occurrences
--   Auto-occurrence generation on template creation
--
-- ═══════════════════════════════════════


-- ═══════════════════════════════════════
-- PHASE 7: Auth columns
-- ═══════════════════════════════════════

ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS email text UNIQUE,
  ADD COLUMN IF NOT EXISTS password_hash text;


-- ═══════════════════════════════════════
-- PHASE 12: Password reset + session invalidation
-- ═══════════════════════════════════════

ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_expires_at ON password_resets(expires_at);


-- ═══════════════════════════════════════
-- VERIFICATION
-- After running all migrations, check:
-- ═══════════════════════════════════════
-- SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';
--   Expected: 6+ tables (users, bill_templates, bill_occurrences, pay_schedules, paycheck_windows, reminders, password_resets)
--
-- SELECT count(*) FROM information_schema.views WHERE table_schema = 'public';
--   Expected: 5 views
--
-- SELECT count(*) FROM information_schema.routines WHERE routine_schema = 'public' AND routine_type = 'FUNCTION';
--   Expected: 5+ functions
