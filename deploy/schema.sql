-- ═══════════════════════════════════════════════════════════════
-- CORIS — Complete Database Schema
-- Run this FIRST on a fresh PostgreSQL 14+ database.
-- Then run deploy/migrations/post-schema-migrations.sql AFTER.
-- ═══════════════════════════════════════════════════════════════

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ═══════════════════════════════════════
-- TABLES
-- ═══════════════════════════════════════

-- Users
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE,
  password_hash text,
  timezone      text NOT NULL DEFAULT 'America/New_York',
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  updated_at    timestamptz NOT NULL DEFAULT NOW()
);

-- Pay Schedules
CREATE TABLE IF NOT EXISTS pay_schedules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  frequency           text NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly')),
  next_paycheck_date  date NOT NULL,
  typical_net_pay     numeric(12,2) NOT NULL DEFAULT 0,
  is_active           boolean NOT NULL DEFAULT TRUE,
  created_at          timestamptz NOT NULL DEFAULT NOW(),
  updated_at          timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pay_schedules_user_id ON pay_schedules(user_id);

-- Paycheck Windows (planning periods between paychecks)
CREATE TABLE IF NOT EXISTS paycheck_windows (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id   uuid NOT NULL REFERENCES pay_schedules(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date    date NOT NULL,
  end_date      date NOT NULL,
  expected_pay  numeric(12,2) NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT TRUE,
  created_at    timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paycheck_windows_user_id ON paycheck_windows(user_id);
CREATE INDEX IF NOT EXISTS idx_paycheck_windows_schedule_id ON paycheck_windows(schedule_id);
CREATE INDEX IF NOT EXISTS idx_paycheck_windows_dates ON paycheck_windows(start_date, end_date);

-- Bill Templates (recurring bill definitions)
CREATE TABLE IF NOT EXISTS bill_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bill_name      text NOT NULL,
  category       text NOT NULL DEFAULT 'general',
  frequency      text NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly','quarterly','yearly')),
  due_day        integer CHECK (due_day IS NULL OR (due_day >= 1 AND due_day <= 31)),
  default_amount numeric(12,2) NOT NULL DEFAULT 0,
  is_variable    boolean NOT NULL DEFAULT FALSE,
  notes          text NOT NULL DEFAULT '',
  is_active      boolean NOT NULL DEFAULT TRUE,
  created_at     timestamptz NOT NULL DEFAULT NOW(),
  updated_at     timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bill_templates_user_id ON bill_templates(user_id);

-- Bill Occurrences (individual bill instances — ledger rows)
CREATE TABLE IF NOT EXISTS bill_occurrences (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id         uuid NOT NULL REFERENCES bill_templates(id) ON DELETE CASCADE,
  due_date            date NOT NULL,
  amount              numeric(12,2) NOT NULL DEFAULT 0,
  amount_paid         numeric(12,2),
  paid_date           timestamptz,
  paycheck_window_id  uuid REFERENCES paycheck_windows(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT NOW(),
  updated_at          timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bill_occurrences_user_id ON bill_occurrences(user_id);
CREATE INDEX IF NOT EXISTS idx_bill_occurrences_template_id ON bill_occurrences(template_id);
CREATE INDEX IF NOT EXISTS idx_bill_occurrences_due_date ON bill_occurrences(due_date);
CREATE INDEX IF NOT EXISTS idx_bill_occurrences_window_id ON bill_occurrences(paycheck_window_id);

-- Reminders / Reminder Logs
CREATE TABLE IF NOT EXISTS reminders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurrence_id   uuid REFERENCES bill_occurrences(id) ON DELETE CASCADE,
  reminder_type   text NOT NULL DEFAULT 'due' CHECK (reminder_type IN ('due','upcoming','overdue')),
  remind_at       timestamptz NOT NULL,
  sent_at_utc     timestamptz,
  failed_at_utc   timestamptz,
  failure_reason  text,
  cancelled       boolean NOT NULL DEFAULT FALSE,
  cancel_reason   text,
  created_at      timestamptz NOT NULL DEFAULT NOW()
);

-- Alias view so worker code referencing "reminder_logs" works
CREATE OR REPLACE VIEW reminder_logs AS SELECT * FROM reminders;

CREATE INDEX IF NOT EXISTS idx_reminders_user_id ON reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_occurrence_id ON reminders(occurrence_id);
CREATE INDEX IF NOT EXISTS idx_reminders_remind_at ON reminders(remind_at);


-- ═══════════════════════════════════════
-- HELPER FUNCTION: user's "today" in their timezone
-- ═══════════════════════════════════════

CREATE OR REPLACE FUNCTION coris_user_today(p_user_id uuid)
RETURNS date
LANGUAGE sql STABLE
AS $$
  SELECT (NOW() AT TIME ZONE COALESCE(
    (SELECT timezone FROM users WHERE id = p_user_id),
    'America/New_York'
  ))::date;
$$;


-- ═══════════════════════════════════════
-- VIEWS
-- ═══════════════════════════════════════

-- Bill occurrences with computed status
CREATE OR REPLACE VIEW v_bill_occurrences_status AS
SELECT
  o.*,
  bt.bill_name,
  bt.category,
  bt.frequency,
  bt.is_variable,
  CASE
    WHEN o.paid_date IS NOT NULL THEN 'paid'
    WHEN o.due_date < CURRENT_DATE THEN 'overdue'
    WHEN o.due_date = CURRENT_DATE THEN 'due_today'
    WHEN o.due_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'upcoming'
    ELSE 'future'
  END AS status
FROM bill_occurrences o
JOIN bill_templates bt ON bt.id = o.template_id;

-- Paycheck window totals
CREATE OR REPLACE VIEW v_paycheck_window_totals AS
SELECT
  pw.*,
  COALESCE(SUM(o.amount), 0) AS total_due,
  COALESCE(SUM(CASE WHEN o.paid_date IS NOT NULL THEN o.amount_paid ELSE 0 END), 0) AS total_paid,
  COUNT(o.id) AS bill_count,
  COUNT(CASE WHEN o.paid_date IS NOT NULL THEN 1 END) AS paid_count
FROM paycheck_windows pw
LEFT JOIN bill_occurrences o ON o.paycheck_window_id = pw.id
GROUP BY pw.id;

-- Bills inside a specific paycheck window
CREATE OR REPLACE VIEW v_paycheck_window_items AS
SELECT
  o.*,
  bt.bill_name,
  bt.category,
  bt.frequency,
  bt.is_variable,
  o.paycheck_window_id,
  CASE
    WHEN o.paid_date IS NOT NULL THEN 'paid'
    WHEN o.due_date < CURRENT_DATE THEN 'overdue'
    WHEN o.due_date = CURRENT_DATE THEN 'due_today'
    ELSE 'upcoming'
  END AS status
FROM bill_occurrences o
JOIN bill_templates bt ON bt.id = o.template_id
WHERE o.paycheck_window_id IS NOT NULL;

-- Unassigned future unpaid occurrences
CREATE OR REPLACE VIEW v_unassigned_future_unpaid_occurrences AS
SELECT
  o.*,
  bt.bill_name,
  bt.category
FROM bill_occurrences o
JOIN bill_templates bt ON bt.id = o.template_id
WHERE o.paycheck_window_id IS NULL
  AND o.paid_date IS NULL
  AND o.due_date >= CURRENT_DATE;

-- Occurrences assigned to inactive windows
CREATE OR REPLACE VIEW v_occurrences_assigned_to_inactive_windows AS
SELECT
  o.*,
  bt.bill_name,
  bt.category
FROM bill_occurrences o
JOIN bill_templates bt ON bt.id = o.template_id
JOIN paycheck_windows pw ON pw.id = o.paycheck_window_id
WHERE pw.is_active = FALSE
  AND o.paid_date IS NULL;

-- Pending reminder events (unsent, not cancelled, scheduled for now or past)
CREATE OR REPLACE VIEW v_pending_reminder_events AS
SELECT
  r.id AS reminder_log_id,
  r.user_id,
  r.occurrence_id,
  r.reminder_type,
  r.remind_at,
  o.due_date,
  o.amount,
  bt.bill_name,
  u.email
FROM reminders r
JOIN bill_occurrences o ON o.id = r.occurrence_id
JOIN bill_templates bt ON bt.id = o.template_id
JOIN users u ON u.id = r.user_id
WHERE r.sent_at_utc IS NULL
  AND r.failed_at_utc IS NULL
  AND r.cancelled = FALSE
  AND r.remind_at <= NOW();

-- Upcoming reminder events (unsent, not cancelled, scheduled for the future)
CREATE OR REPLACE VIEW v_upcoming_reminder_events AS
SELECT
  r.id AS reminder_log_id,
  r.user_id,
  r.occurrence_id,
  r.reminder_type,
  r.remind_at,
  o.due_date,
  o.amount,
  bt.bill_name
FROM reminders r
JOIN bill_occurrences o ON o.id = r.occurrence_id
JOIN bill_templates bt ON bt.id = o.template_id
WHERE r.sent_at_utc IS NULL
  AND r.failed_at_utc IS NULL
  AND r.cancelled = FALSE
  AND r.remind_at > NOW();


-- ═══════════════════════════════════════
-- FUNCTIONS
-- ═══════════════════════════════════════

-- Generate bill occurrences for a user (look-ahead days)
CREATE OR REPLACE FUNCTION coris_generate_bill_occurrences_for_user(
  p_user_id uuid,
  p_days_ahead integer DEFAULT 180
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  t RECORD;
  next_due date;
  horizon date := CURRENT_DATE + p_days_ahead;
  interval_step interval;
BEGIN
  FOR t IN
    SELECT * FROM bill_templates
    WHERE user_id = p_user_id AND is_active = TRUE
  LOOP
    -- Determine the interval
    interval_step := CASE t.frequency
      WHEN 'weekly' THEN INTERVAL '7 days'
      WHEN 'biweekly' THEN INTERVAL '14 days'
      WHEN 'monthly' THEN INTERVAL '1 month'
      WHEN 'quarterly' THEN INTERVAL '3 months'
      WHEN 'yearly' THEN INTERVAL '1 year'
    END;

    -- Find the latest existing occurrence
    SELECT MAX(due_date) INTO next_due
    FROM bill_occurrences
    WHERE template_id = t.id AND user_id = p_user_id;

    IF next_due IS NULL THEN
      -- No occurrences yet — start from due_day this month or next
      IF t.due_day IS NOT NULL THEN
        next_due := make_date(
          EXTRACT(YEAR FROM CURRENT_DATE)::int,
          EXTRACT(MONTH FROM CURRENT_DATE)::int,
          LEAST(t.due_day, 28)
        );
        IF next_due < CURRENT_DATE THEN
          next_due := next_due + interval_step;
        END IF;
      ELSE
        next_due := CURRENT_DATE;
      END IF;
    ELSE
      next_due := next_due + interval_step;
    END IF;

    -- Generate occurrences up to horizon
    WHILE next_due <= horizon LOOP
      -- Only insert if not already existing for this template+date
      INSERT INTO bill_occurrences (user_id, template_id, due_date, amount, created_at, updated_at)
      SELECT p_user_id, t.id, next_due, t.default_amount, NOW(), NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM bill_occurrences
        WHERE template_id = t.id AND due_date = next_due AND user_id = p_user_id
      );

      next_due := next_due + interval_step;
    END LOOP;
  END LOOP;
END;
$$;

-- Generate paycheck windows for a schedule (look-ahead days)
CREATE OR REPLACE FUNCTION coris_generate_paycheck_windows_for_schedule(
  p_schedule_id uuid,
  p_days_ahead integer DEFAULT 180
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  sched RECORD;
  win_start date;
  win_end date;
  horizon date := CURRENT_DATE + p_days_ahead;
  interval_step interval;
BEGIN
  SELECT * INTO sched FROM pay_schedules WHERE id = p_schedule_id;
  IF NOT FOUND THEN RETURN; END IF;

  interval_step := CASE sched.frequency
    WHEN 'weekly' THEN INTERVAL '7 days'
    WHEN 'biweekly' THEN INTERVAL '14 days'
    WHEN 'monthly' THEN INTERVAL '1 month'
  END;

  -- Start from next_paycheck_date or latest window end
  SELECT MAX(end_date) INTO win_start
  FROM paycheck_windows
  WHERE schedule_id = p_schedule_id;

  IF win_start IS NULL THEN
    win_start := sched.next_paycheck_date;
  ELSE
    win_start := win_start + INTERVAL '1 day';
  END IF;

  WHILE win_start <= horizon LOOP
    win_end := (win_start + interval_step) - INTERVAL '1 day';

    INSERT INTO paycheck_windows (schedule_id, user_id, start_date, end_date, expected_pay, is_active, created_at)
    SELECT sched.user_id, sched.user_id, win_start, win_end, sched.typical_net_pay, TRUE, NOW()
    WHERE NOT EXISTS (
      SELECT 1 FROM paycheck_windows
      WHERE schedule_id = p_schedule_id AND start_date = win_start
    );

    win_start := win_end + INTERVAL '1 day';
  END LOOP;
END;
$$;

-- Assign unassigned occurrences to active paycheck windows
CREATE OR REPLACE FUNCTION coris_assign_occurrences_to_active_windows(
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE bill_occurrences o
  SET paycheck_window_id = pw.id,
      updated_at = NOW()
  FROM paycheck_windows pw
  WHERE o.user_id = p_user_id
    AND pw.user_id = p_user_id
    AND pw.is_active = TRUE
    AND o.paycheck_window_id IS NULL
    AND o.paid_date IS NULL
    AND o.due_date BETWEEN pw.start_date AND pw.end_date;
END;
$$;

-- Cancel unsent reminders for an occurrence (e.g. when marking paid)
CREATE OR REPLACE FUNCTION coris_cancel_unsent_reminders_for_occurrence(
  p_occurrence_id uuid,
  p_reason text DEFAULT 'cancelled'
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE reminders
  SET cancelled = TRUE,
      cancel_reason = p_reason
  WHERE occurrence_id = p_occurrence_id
    AND sent_at_utc IS NULL
    AND cancelled = FALSE;
END;
$$;

-- Generate default reminders for a user's upcoming bills
CREATE OR REPLACE FUNCTION coris_generate_default_reminders_for_user(
  p_user_id uuid,
  p_days_ahead integer DEFAULT 120
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  occ RECORD;
BEGIN
  FOR occ IN
    SELECT o.id, o.due_date, o.user_id
    FROM bill_occurrences o
    WHERE o.user_id = p_user_id
      AND o.paid_date IS NULL
      AND o.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + p_days_ahead
  LOOP
    -- "due" reminder: morning of due date
    INSERT INTO reminders (user_id, occurrence_id, reminder_type, remind_at, created_at)
    SELECT p_user_id, occ.id, 'due', occ.due_date::timestamptz + INTERVAL '8 hours', NOW()
    WHERE NOT EXISTS (
      SELECT 1 FROM reminders
      WHERE occurrence_id = occ.id AND reminder_type = 'due' AND cancelled = FALSE
    );
  END LOOP;
END;
$$;


-- ═══════════════════════════════════════
-- LEDGER IMMUTABILITY TRIGGER
-- Prevent edits to paid bill occurrences (except via system)
-- ═══════════════════════════════════════

CREATE OR REPLACE FUNCTION prevent_paid_occurrence_edit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Allow if it's being marked paid right now
  IF OLD.paid_date IS NULL AND NEW.paid_date IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Allow updating paycheck_window_id assignment
  IF OLD.paycheck_window_id IS DISTINCT FROM NEW.paycheck_window_id
     AND OLD.paid_date IS NULL THEN
    RETURN NEW;
  END IF;

  -- Allow updating amount on unpaid variable bills
  IF OLD.amount IS DISTINCT FROM NEW.amount AND OLD.paid_date IS NULL THEN
    RETURN NEW;
  END IF;

  -- Block changes to already-paid occurrences
  IF OLD.paid_date IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot modify a paid bill occurrence (ledger immutability)';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_paid_edit ON bill_occurrences;
CREATE TRIGGER trg_prevent_paid_edit
  BEFORE UPDATE ON bill_occurrences
  FOR EACH ROW
  EXECUTE FUNCTION prevent_paid_occurrence_edit();


-- ═══════════════════════════════════════
-- DONE — Now run deploy/migrations/post-schema-migrations.sql
-- ═══════════════════════════════════════
