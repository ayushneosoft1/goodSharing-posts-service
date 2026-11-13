import test, { after, mock } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../db.js";
import { redis } from "../redis.js";
import { resolvers } from "../resolvers.js";
import { publishOutboxBatch } from "../services/outboxPublisher.js";

test("post creation succeeds during notification outage and outbox delivers later", async () => {
  const events = [];
  const sentPayloads = [];
  let now = Date.now();
  let postCommitted = false;

  const postClient = {
    async query(sql, params = []) {
      const normalized = sql.trim().replace(/\s+/g, " ").toUpperCase();

      if (["BEGIN", "ROLLBACK"].includes(normalized)) {
        return { rows: [], rowCount: 0 };
      }

      if (normalized === "COMMIT") {
        postCommitted = true;
        return { rows: [], rowCount: 0 };
      }

      if (normalized.includes("INSERT INTO POSTS")) {
        return {
          rows: [{
            id: "501",
            title: "Test Book",
            category: "BOOK",
            description: "Test description",
            image_url: null,
            location: "Test Location",
            is_deleted: false,
            created_at: "2026-10-05T10:00:00.000Z",
            updated_at: "2026-10-05T10:00:00.000Z",
            user_id: "162",
          }],
          rowCount: 1,
        };
      }

      if (normalized.includes("INSERT INTO PUBLIC.OUTBOX_EVENTS")) {
        events.push({
          event_id: params[0],
          payload: JSON.parse(params[3]),
          status: "PENDING",
          attempts: 0,
          nextAttemptAt: now,
          lockedAt: null,
        });
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected post SQL: ${normalized}`);
    },
    release() {},
  };

  const publisherDb = {
    async connect() {
      return {
        async query(sql, params = []) {
          const normalized = sql.trim().replace(/\s+/g, " ").toUpperCase();

          if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) {
            return { rows: [], rowCount: 0 };
          }

          if (normalized.includes("LOCKED_AT <")) {
            return { rows: [], rowCount: 0 };
          }

          if (normalized.includes("WITH CANDIDATES AS")) {
            const claimed = events.filter(
              (event) =>
                event.status === "PENDING" &&
                event.nextAttemptAt <= now,
            ).slice(0, params[0]);

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

          throw new Error(`Unexpected publisher client SQL: ${normalized}`);
        },
        release() {},
      };
    },

    async query(sql, params = []) {
      const normalized = sql.trim().replace(/\s+/g, " ").toUpperCase();
      const event = events.find((item) => item.event_id === params[0]);

      assert.ok(event, "publisher must update the persisted outbox event");

      if (normalized.includes("SET STATUS = 'SENT'")) {
        const ownsClaim =
          event.status === "PROCESSING" &&
          event.attempts === params[1] &&
          event.lockedAt === params[2];

        if (!ownsClaim) return { rows: [], rowCount: 0 };

        event.status = "SENT";
        event.lockedAt = null;
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
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected publisher SQL: ${normalized}`);
    },
  };

  mock.method(pool, "connect", async () => postClient);
  mock.method(redis, "del", async () => 1);

  const logger = { warn() {}, error() {} };

  try {
    const post = await resolvers.Mutation.createPost(
      null,
      {
        title: "Test Book",
        category: "BOOK",
        description: "Test description",
        imageUrl: null,
        location: "Test Location",
      },
      { user: { id: "162" } },
    );

    assert.equal(post.id, "501");
    assert.equal(postCommitted, true);
    assert.equal(events.length, 1);
    assert.equal(events[0].status, "PENDING");
    assert.equal(sentPayloads.length, 0);

    const originalPayload = structuredClone(events[0].payload);

    const failedDelivery = await publishOutboxBatch({
      db: publisherDb,
      sendEvent: async (payload) => {
        sentPayloads.push(structuredClone(payload));
        throw new Error("Notification service unavailable");
      },
      random: () => 0,
      logger,
    });

    assert.deepEqual(failedDelivery, {
      claimed: 1,
      sent: 0,
      retried: 1,
    });
    assert.equal(events[0].status, "PENDING");
    assert.equal(events[0].attempts, 1);
    assert.ok(events[0].nextAttemptAt > now);

    now = events[0].nextAttemptAt + 1;

    const recoveredDelivery = await publishOutboxBatch({
      db: publisherDb,
      sendEvent: async (payload) => {
        sentPayloads.push(structuredClone(payload));
      },
      random: () => 0,
      logger,
    });

    assert.deepEqual(recoveredDelivery, {
      claimed: 1,
      sent: 1,
      retried: 0,
    });
    assert.equal(events[0].status, "SENT");
    assert.equal(events[0].attempts, 2);
    assert.deepEqual(sentPayloads[0], originalPayload);
    assert.deepEqual(sentPayloads[1], originalPayload);
    assert.equal(sentPayloads[0].eventId, events[0].event_id);
  } finally {
    mock.restoreAll();
  }
});

after(async () => {
  try {
    if (redis.status !== "wait" && redis.status !== "end") {
      await redis.quit();
    } else {
      redis.disconnect();
    }
  } catch {
    redis.disconnect();
  }
});
