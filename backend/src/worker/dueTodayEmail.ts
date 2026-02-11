import { query } from "../lib/db.js";
import { createMailer } from "../lib/mailer.js";

/**
 * Phase 13 (minimal): send "due today" reminder emails only.
 *
 * This worker is designed to be run by cron every 5 minutes.
 * It is safe to run repeatedly, it will not double-send because it marks rows sent.
 *
 * Assumptions from earlier DB phases:
 * - v_pending_reminder_events view exists and includes:
 *   - user_id
 *   - occurrence_id
 *   - reminder_type
 *   - scheduled_send_at_utc
 *   - (id OR reminder_log_id) to update reminder_logs
 * - reminder_logs table has sent_at_utc and failed_at_utc (or similarly named) columns.
 *
 * If your DB uses different column names, adjust the UPDATE statements below.
 */

type PendingRow = {
  id?: string;
  reminder_log_id?: string;
  user_id: string;
  occurrence_id: string;
  reminder_type: string;
  scheduled_send_at_utc: string;
};

type OccurrenceDetail = {
  email: string;
  bill_name: string;
  due_date: string;
  amount_due: number | string;
};

function nowIso(){
  return new Date().toISOString();
}

function pickReminderId(r: PendingRow){
  return r.reminder_log_id ?? r.id;
}

async function fetchDueToday(maxBatch: number): Promise<PendingRow[]>{
  // Only due-today reminders that are scheduled to send by now.
  // We order by scheduled time for predictable processing.
  return await query<PendingRow>(`
    SELECT *
    FROM v_pending_reminder_events
    WHERE reminder_type = 'due'
      AND scheduled_send_at_utc <= NOW()
    ORDER BY scheduled_send_at_utc ASC
    LIMIT $1
  `, [maxBatch]);
}

async function fetchOccurrenceDetail(userId: string, occurrenceId: string): Promise<OccurrenceDetail | null>{
  const rows = await query<OccurrenceDetail>(`
    SELECT
      u.email AS email,
      t.name AS bill_name,
      o.due_date::text AS due_date,
      o.amount_due AS amount_due
    FROM bill_occurrences o
    JOIN bill_templates t ON t.id = o.template_id
    JOIN users u ON u.id = o.user_id
    WHERE o.id = $1 AND o.user_id = $2
    LIMIT 1
  `, [occurrenceId, userId]);

  return rows.length ? rows[0] : null;
}

async function markSent(reminderId: string){
  // Mark sent only if still unsent. This is your at-most-once guarantee.
  const rows = await query<{ id: string }>(`
    UPDATE reminder_logs
    SET sent_at_utc = NOW()
    WHERE id = $1 AND sent_at_utc IS NULL AND canceled_at_utc IS NULL
    RETURNING id
  `, [reminderId]);

  return rows.length === 1;
}

async function markFailed(reminderId: string, reason: string){
  await query(`
    UPDATE reminder_logs
    SET failed_at_utc = NOW(),
        failure_reason = LEFT($2, 500)
    WHERE id = $1 AND sent_at_utc IS NULL AND canceled_at_utc IS NULL
  `, [reminderId, reason]);
}

function buildEmailText(d: OccurrenceDetail){
  return [
    "CORIS bill reminder",
    "",
    "Your bill is due today.",
    "",
    `Bill: ${d.bill_name}`,
    `Due date: ${d.due_date}`,
    `Amount: ${d.amount_due}`,
    "",
    "Open CORIS to review your plan.",
  ].join("\n");
}

async function main(){
  const mailer = createMailer();
  const batchSize = Number(process.env.REMINDER_BATCH_SIZE ?? "50");

  // eslint-disable-next-line no-console
  console.log(`[PHASE13] due-today worker start ${nowIso()} batchSize=${batchSize}`);

  const rows = await fetchDueToday(batchSize);
  if(!rows.length){
    // eslint-disable-next-line no-console
    console.log("[PHASE13] nothing to send");
    return;
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for(const r of rows){
    const reminderId = pickReminderId(r);
    if(!reminderId){
      skipped++;
      continue;
    }

    try{
      // Mark sent first? We mark AFTER sending, but we keep idempotent by checking row still unsent.
      // If two workers run, only one can successfully markSent after send.
      const detail = await fetchOccurrenceDetail(r.user_id, r.occurrence_id);
      if(!detail || !detail.email){
        skipped++;
        continue;
      }

      await mailer.send(detail.email, "Bill due today", buildEmailText(detail));

      const ok = await markSent(reminderId);
      if(ok) sent++;
      else skipped++;
    }catch(err: any){
      failed++;
      await markFailed(reminderId, err?.message ? String(err.message) : "send failed");
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[PHASE13] done sent=${sent} skipped=${skipped} failed=${failed}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[PHASE13] worker crash", err);
  process.exit(1);
});
