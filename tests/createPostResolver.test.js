import test, { after, mock } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../db.js";
import { redis } from "../redis.js";
import { resolvers } from "../resolvers.js";

const postRow = (id = "501") => ({
  id,
  title: "Test Book",
  category: "BOOK",
  description: "Test description",
  image_url: null,
  location: "Test Location",
  is_deleted: false,
  created_at: "2026-10-05T10:00:00.000Z",
  updated_at: "2026-10-05T10:00:00.000Z",
  user_id: "162",
});

function createClient({ postInsertError, outboxInsertError } = {}) {
  const queries = [];
  let released = false;

  const client = {
    async query(sql, params = []) {
      const normalized = sql.trim().replace(/\s+/g, " ").toUpperCase();
      queries.push({ sql: normalized, params });

      if (normalized === "BEGIN" || normalized === "COMMIT" ||
          normalized === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }

      if (normalized.includes("INSERT INTO POSTS")) {
        if (postInsertError) throw postInsertError;
        return { rows: [postRow()], rowCount: 1 };
      }

      if (normalized.includes("INSERT INTO PUBLIC.OUTBOX_EVENTS")) {
        if (outboxInsertError) throw outboxInsertError;
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected SQL query: ${normalized}`);
    },
    release() {
      released = true;
    },
  };

  return {
    client,
    queries,
    isReleased: () => released,
  };
}

async function createPost() {
  return resolvers.Mutation.createPost(
    null,
    {
      title: "Test Book",
      category: "BOOK",
      description: "Test description",
      imageUrl: null,
      location: "Test Location",
    },
    {
      user: { id: "162" },
    },
  );
}

test("createPost saves post and outbox event in one transaction", async () => {
  const fake = createClient();

  mock.method(pool, "connect", async () => fake.client);
  mock.method(redis, "del", async () => 1);

  try {
    const result = await createPost();

    assert.equal(result.id, "501");
    assert.equal(result.title, "Test Book");
    assert.equal(result.category, "BOOK");

    assert.equal(fake.queries[0].sql, "BEGIN");
    assert.ok(fake.queries[1].sql.includes("INSERT INTO POSTS"));
    assert.ok(fake.queries[2].sql.includes("INSERT INTO PUBLIC.OUTBOX_EVENTS"));
    assert.equal(fake.queries[3].sql, "COMMIT");

    const outboxParams = fake.queries[2].params;
    const payload = JSON.parse(outboxParams[3]);

    assert.equal(outboxParams[0], payload.eventId);
    assert.equal(outboxParams[1], "PostCreated");
    assert.equal(outboxParams[2], "501");
    assert.equal(payload.eventType, "PostCreated");
    assert.equal(payload.postId, "501");
    assert.equal(payload.authorId, "162");
    assert.equal(payload.categoryId, "1");
    assert.equal(payload.title, "Test Book");
    assert.equal(payload.createdAt, "2026-10-05T10:00:00.000Z");

    assert.equal(fake.isReleased(), true);
  } finally {
    mock.restoreAll();
  }
});

test("Redis cache invalidation failure does not fail post creation", async () => {
  const fake = createClient();

  mock.method(pool, "connect", async () => fake.client);
  mock.method(redis, "del", async () => {
    throw new Error("Redis unavailable");
  });

  try {
    const result = await createPost();

    assert.equal(result.id, "501");
    assert.equal(fake.queries.at(-1).sql, "COMMIT");
    assert.equal(fake.isReleased(), true);
  } finally {
    mock.restoreAll();
  }
});

test("failed post insert rolls back and does not insert an outbox event", async () => {
  const fake = createClient({
    postInsertError: new Error("database insert failed"),
  });

  mock.method(pool, "connect", async () => fake.client);

  try {
    await assert.rejects(createPost(), /database insert failed/);

    assert.equal(fake.queries[0].sql, "BEGIN");
    assert.ok(fake.queries.some((query) => query.sql === "ROLLBACK"));
    assert.equal(
      fake.queries.some((query) =>
        query.sql.includes("INSERT INTO PUBLIC.OUTBOX_EVENTS"),
      ),
      false,
    );
    assert.equal(fake.isReleased(), true);
  } finally {
    mock.restoreAll();
  }
});

test("failed outbox insert rolls back the post transaction", async () => {
  const fake = createClient({
    outboxInsertError: new Error("outbox insert failed"),
  });

  mock.method(pool, "connect", async () => fake.client);

  try {
    await assert.rejects(createPost(), /outbox insert failed/);

    assert.ok(fake.queries.some((query) => query.sql.includes("INSERT INTO POSTS")));
    assert.ok(fake.queries.some((query) =>
      query.sql.includes("INSERT INTO PUBLIC.OUTBOX_EVENTS"),
    ));
    assert.ok(fake.queries.some((query) => query.sql === "ROLLBACK"));
    assert.equal(fake.queries.some((query) => query.sql === "COMMIT"), false);
    assert.equal(fake.isReleased(), true);
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
