import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateRetryDelayMs,
  publishOutboxBatch,
} from "../services/outboxPublisher.js";

function createFakeDb(initialEvents = []) {
  const events = initialEvents.map((event) => ({ ...event }));
  const queries = [];
  let now = Date.now();

  const client = {
    async query(sql, params = []) {
      const normalized = sql.trim().replace(/\s+/g, " ").toUpperCase();
      queries.push({ sql: normalized, params });

      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) {
        return { rows: [], rowCount: 0 };
      }

      if (normalized.includes("WITH CANDIDATES AS")) {
        const batchSize = params[0];
        const claimed = events
          .filter((event) =>
            event.status === "PENDING" &&
            event.nextAttemptAt <= now
          )
          .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
          .slice(0, batchSize);

        for (const event of claimed) {
          event.status = "PROCESSING";
          event.attempts += 1;
          event.lockedAt = now;
        }

        return {
          rows: claimed.map((event) => ({
            event_id: event.event_id,
            payload: event.payload,
            attempts: event.attempts,
            locked_at: event.lockedAt,
          })),
        };
      }

      if (
        normalized.includes("UPDATE PUBLIC.OUTBOX_EVENTS") &&
        normalized.includes("STATUS = 'PENDING'") &&
        normalized.includes("LOCKED_AT <")
      ) {
        for (const event of events) {
          if (
            event.status === "PROCESSING" &&
            event.lockedAt !== null &&
            event.lockedAt < now - params[0] * 60_000
          ) {
            event.status = "PENDING";
            event.lockedAt = null;
          }
        }
        return { rows: [], rowCount: 0 };
      }

      throw new Error(`Unexpected client SQL: ${normalized}`);
    },

    release() {},
  };

  const db = {
    async connect() {
      return client;
    },

    async query(sql, params = []) {
      const normalized = sql.trim().replace(/\s+/g, " ").toUpperCase();
      queries.push({ sql: normalized, params });

      const event = events.find((item) => item.event_id === params[0]);
      if (!event) {
        return { rows: [], rowCount: 0 };
      }

      if (normalized.includes("SET STATUS = 'SENT'")) {
        const ownsClaim =
          event.status === "PROCESSING" &&
          event.attempts === params[1] &&
          event.lockedAt === params[2];

        if (!ownsClaim) return { rows: [], rowCount: 0 };

        event.status = "SENT";
        event.sentAt = now;
        event.lockedAt = null;
        event.lastError = null;
        return { rows: [], rowCount: 1 };
      }

      if (normalized.includes("SET STATUS = 'PENDING'")) {
        const ownsClaim =
          event.status === "PROCESSING" &&
          event.attempts === params[3] &&
          event.lockedAt === params[4];

        if (!ownsClaim) return { rows: [], rowCount: 0 };

        event.status = "PENDING";
        event.nextAttemptAt = now + params[1];
        event.lockedAt = null;
        event.lastError = params[2];
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected pool SQL: ${normalized}`);
    },
  };

  return {
    db,
    events,
    queries,
    advanceTime(milliseconds) {
      now += milliseconds;
    },
    currentTime() {
      return now;
    },
  };
}

function createEvent(overrides = {}) {
  return {
    event_id: "event-001",
    payload: {
      eventId: "event-001",
      eventType: "PostCreated",
      postId: "501",
      authorId: "162",
      categoryId: "1",
      title: "Test Book",
      createdAt: "2026-10-05T10:00:00.000Z",
    },
    status: "PENDING",
    attempts: 0,
    nextAttemptAt: Date.now() - 1000,
    lockedAt: null,
    ...overrides,
  };
}

test("failed delivery schedules retry and later success sends the same event", async () => {
  const fake = createFakeDb([createEvent()]);
  const sentPayloads = [];
  const logger = { warn() {}, error() {} };

  const firstResult = await publishOutboxBatch({
    db: fake.db,
    sendEvent: async (payload) => {
      sentPayloads.push(payload);
      throw new Error("Notification service unavailable");
    },
    random: () => 0,
    logger,
  });

  assert.deepEqual(firstResult, { claimed: 1, sent: 0, retried: 1 });
  assert.equal(fake.events[0].status, "PENDING");
  assert.equal(fake.events[0].attempts, 1);
  assert.equal(fake.events[0].nextAttemptAt - fake.currentTime(), 30_000);
  assert.equal(fake.events[0].lastError, "Error");

  fake.advanceTime(30_001);

  const secondResult = await publishOutboxBatch({
    db: fake.db,
    sendEvent: async (payload) => {
      sentPayloads.push(payload);
    },
    random: () => 0,
    logger,
  });

  assert.deepEqual(secondResult, { claimed: 1, sent: 1, retried: 0 });
  assert.equal(fake.events[0].status, "SENT");
  assert.equal(fake.events[0].attempts, 2);
  assert.deepEqual(sentPayloads[0], sentPayloads[1]);
  assert.equal(sentPayloads[0].eventId, "event-001");
});

test("stale PROCESSING event is recovered and published", async () => {
  const fake = createFakeDb([
    createEvent({
      status: "PROCESSING",
      attempts: 1,
      lockedAt: Date.now() - 6 * 60_000,
    }),
  ]);

  const result = await publishOutboxBatch({
    db: fake.db,
    sendEvent: async () => {},
    logger: { warn() {}, error() {} },
  });

  assert.deepEqual(result, { claimed: 1, sent: 1, retried: 0 });
  assert.equal(fake.events[0].status, "SENT");
  assert.equal(fake.events[0].attempts, 2);
});

test("outbox claim uses FOR UPDATE SKIP LOCKED", async () => {
  const fake = createFakeDb([createEvent()]);

  await publishOutboxBatch({
    db: fake.db,
    sendEvent: async () => {},
    logger: { warn() {}, error() {} },
  });

  const claimQuery = fake.queries.find(({ sql }) =>
    sql.includes("WITH CANDIDATES AS"),
  );

  assert.ok(claimQuery);
  assert.match(claimQuery.sql, /FOR UPDATE SKIP LOCKED/);
});


test("stale worker cannot mark a replacement worker claim as SENT", async () => {
  const fake = createFakeDb([createEvent()]);
  const logger = { warn() {}, error() {} };

  let releaseA;
  let notifyAStarted;
  const gateA = new Promise((resolve) => { releaseA = resolve; });
  const startedA = new Promise((resolve) => { notifyAStarted = resolve; });

  const workerA = publishOutboxBatch({
    db: fake.db,
    sendEvent: async () => {
      notifyAStarted();
      await gateA;
    },
    logger,
  });

  await startedA;
  const firstClaimTime = fake.events[0].lockedAt;
  fake.advanceTime(5 * 60_000 + 1);

  let releaseB;
  let notifyBStarted;
  const gateB = new Promise((resolve) => { releaseB = resolve; });
  const startedB = new Promise((resolve) => { notifyBStarted = resolve; });

  const workerB = publishOutboxBatch({
    db: fake.db,
    sendEvent: async () => {
      notifyBStarted();
      await gateB;
    },
    logger,
  });

  await startedB;
  const replacementClaimTime = fake.events[0].lockedAt;

  assert.equal(fake.events[0].status, "PROCESSING");
  assert.equal(fake.events[0].attempts, 2);
  assert.notEqual(replacementClaimTime, firstClaimTime);

  releaseA();
  const resultA = await workerA;

  assert.deepEqual(resultA, { claimed: 1, sent: 0, retried: 0 });
  assert.equal(fake.events[0].status, "PROCESSING");
  assert.equal(fake.events[0].attempts, 2);
  assert.equal(fake.events[0].lockedAt, replacementClaimTime);

  releaseB();
  const resultB = await workerB;

  assert.deepEqual(resultB, { claimed: 1, sent: 1, retried: 0 });
  assert.equal(fake.events[0].status, "SENT");
});

test("stale worker cannot schedule retry for a replacement worker claim", async () => {
  const fake = createFakeDb([createEvent()]);
  const logger = { warn() {}, error() {} };

  let rejectA;
  let notifyAStarted;
  const gateA = new Promise((_, reject) => { rejectA = reject; });
  const startedA = new Promise((resolve) => { notifyAStarted = resolve; });

  const workerA = publishOutboxBatch({
    db: fake.db,
    sendEvent: async () => {
      notifyAStarted();
      await gateA;
    },
    logger,
  });

  await startedA;
  fake.advanceTime(5 * 60_000 + 1);

  let releaseB;
  let notifyBStarted;
  const gateB = new Promise((resolve) => { releaseB = resolve; });
  const startedB = new Promise((resolve) => { notifyBStarted = resolve; });

  const workerB = publishOutboxBatch({
    db: fake.db,
    sendEvent: async () => {
      notifyBStarted();
      await gateB;
    },
    logger,
  });

  await startedB;
  const replacementClaimTime = fake.events[0].lockedAt;

  rejectA(new Error("Old worker delivery failed"));
  const resultA = await workerA;

  assert.deepEqual(resultA, { claimed: 1, sent: 0, retried: 0 });
  assert.equal(fake.events[0].status, "PROCESSING");
  assert.equal(fake.events[0].attempts, 2);
  assert.equal(fake.events[0].lockedAt, replacementClaimTime);

  releaseB();
  const resultB = await workerB;

  assert.deepEqual(resultB, { claimed: 1, sent: 1, retried: 0 });
  assert.equal(fake.events[0].status, "SENT");
});

test("retry delay increases by attempt and includes bounded jitter", () => {
  assert.equal(calculateRetryDelayMs(1, () => 0), 30_000);
  assert.equal(calculateRetryDelayMs(2, () => 0), 60_000);
  assert.equal(calculateRetryDelayMs(3, () => 0), 120_000);
  assert.equal(calculateRetryDelayMs(4, () => 0), 240_000);
  assert.equal(calculateRetryDelayMs(5, () => 0), 240_000);
  assert.equal(calculateRetryDelayMs(1, () => 0.5), 35_000);
  assert.equal(calculateRetryDelayMs(1, () => 0.9999), 39_999);
});
