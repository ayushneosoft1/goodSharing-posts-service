import { pool } from "../db.js";
import { sendPostCreatedEvent } from "./notificationEventService.js";

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_INTERVAL_MS = 5000;
const STALE_LOCK_MINUTES = 5;
const MAX_RETRY_DELAY_MS = 240000;
const RETRY_BASE_DELAYS_MS = [30000, 60000, 120000, 240000];

let workerRunning = false;
let batchInProgress = false;

export function calculateRetryDelayMs(attempt, random = Math.random) {
  const index = Math.min(Math.max(Number(attempt) - 1, 0), RETRY_BASE_DELAYS_MS.length - 1);
  const baseDelay = Math.min(RETRY_BASE_DELAYS_MS[index], MAX_RETRY_DELAY_MS);
  const jitter = Math.floor(random() * 10000);

  return baseDelay + jitter;
}

async function claimOutboxEvents(db, batchSize) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `
      UPDATE public.outbox_events
      SET
        status = 'PENDING',
        locked_at = NULL,
        updated_at = NOW()
      WHERE status = 'PROCESSING'
        AND locked_at < NOW() - ($1 * INTERVAL '1 minute')
      `,
      [STALE_LOCK_MINUTES],
    );

    const { rows } = await client.query(
      `
      WITH candidates AS (
        SELECT event_id
        FROM public.outbox_events
        WHERE status = 'PENDING'
          AND next_attempt_at <= NOW()
        ORDER BY next_attempt_at ASC, created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE public.outbox_events AS events
      SET
        status = 'PROCESSING',
        attempts = events.attempts + 1,
        locked_at = NOW(),
        updated_at = NOW()
      FROM candidates
      WHERE events.event_id = candidates.event_id
      RETURNING
        events.event_id,
        events.payload,
        events.attempts,
        events.locked_at
      `,
      [batchSize],
    );

    await client.query("COMMIT");
    return rows;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original database error.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function markEventSent(db, event) {
  const result = await db.query(
    `
    UPDATE public.outbox_events
    SET
      status = 'SENT',
      sent_at = NOW(),
      locked_at = NULL,
      last_error = NULL,
      updated_at = NOW()
    WHERE event_id = $1
      AND status = 'PROCESSING'
      AND attempts = $2
      AND locked_at = $3
    `,
    [event.event_id, event.attempts, event.locked_at],
  );

  return result.rowCount === 1;
}

async function scheduleEventRetry(db, event, error, random) {
  const delayMs = calculateRetryDelayMs(event.attempts, random);
  const errorName = String(error?.name || "DeliveryError").slice(0, 100);

  const result = await db.query(
    `
    UPDATE public.outbox_events
    SET
      status = 'PENDING',
      next_attempt_at = NOW() + ($2 * INTERVAL '1 millisecond'),
      locked_at = NULL,
      last_error = $3,
      updated_at = NOW()
    WHERE event_id = $1
      AND status = 'PROCESSING'
      AND attempts = $4
      AND locked_at = $5
    `,
    [event.event_id, delayMs, errorName, event.attempts, event.locked_at],
  );

  return {
    delayMs,
    scheduled: result.rowCount === 1,
  };
}

export async function publishOutboxBatch({
  db = pool,
  sendEvent = sendPostCreatedEvent,
  batchSize = DEFAULT_BATCH_SIZE,
  random = Math.random,
  logger = console,
} = {}) {
  const events = await claimOutboxEvents(db, batchSize);
  const results = {
    claimed: events.length,
    sent: 0,
    retried: 0,
  };

  for (const event of events) {
    try {
      await sendEvent(event.payload);
      const markedSent = await markEventSent(db, event);

      if (markedSent) {
        results.sent += 1;
      } else {
        logger.warn("OUTBOX_EVENT_CLAIM_LOST", {
          eventId: event.event_id,
          attempt: event.attempts,
          operation: "mark_sent",
        });
      }
    } catch (error) {
      try {
        const retry = await scheduleEventRetry(db, event, error, random);

        if (!retry.scheduled) {
          logger.warn("OUTBOX_EVENT_CLAIM_LOST", {
            eventId: event.event_id,
            attempt: event.attempts,
            operation: "schedule_retry",
          });
          continue;
        }

        results.retried += 1;

        logger.warn("OUTBOX_EVENT_RETRY_SCHEDULED", {
          eventId: event.event_id,
          attempt: event.attempts,
          retryDelayMs: retry.delayMs,
          error: String(error?.name || "DeliveryError"),
        });
      } catch (updateError) {
        logger.error("OUTBOX_EVENT_RETRY_UPDATE_FAILED", {
          eventId: event.event_id,
          error: String(updateError?.name || "DatabaseError"),
        });
      }
    }
  }

  return results;
}

export function startOutboxPublisher(options = {}) {
  const intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS;
  const logger = options.logger || console;

  if (workerRunning) {
    return () => {};
  }

  workerRunning = true;

  const run = async () => {
    if (batchInProgress) {
      return;
    }

    batchInProgress = true;

    try {
      const result = await publishOutboxBatch(options);

      if (result.claimed > 0) {
        logger.info("OUTBOX_BATCH_COMPLETED", result);
      }
    } catch (error) {
      logger.error("OUTBOX_BATCH_FAILED", {
        error: String(error?.name || "OutboxError"),
      });
    } finally {
      batchInProgress = false;
    }
  };

  void run();

  const timer = setInterval(() => {
    void run();
  }, intervalMs);

  timer.unref?.();

  return () => {
    clearInterval(timer);
    workerRunning = false;
  };
}
