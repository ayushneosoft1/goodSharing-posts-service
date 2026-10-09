import test, { after, mock } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../db.js";
import { redis } from "../redis.js";
import { notificationEventService } from "../services/notificationEventService.js";
import { resolvers } from "../resolvers.js";

test("createPost saves the post and triggers PostCreated notification", async () => {
  const originalQuery = pool.query;
  const originalDel = redis.del;
  const originalNotify = notificationEventService.notifyPostCreated;

  let notificationArgs = null;

  mock.method(pool, "query", async () => ({
    rows: [
      {
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
      },
    ],
  }));

  mock.method(redis, "del", async () => 1);

  notificationEventService.notifyPostCreated = async (post, authorId) => {
    notificationArgs = { post, authorId };
    return { delivered: true, eventId: "test-event-id" };
  };

  try {
    const result = await resolvers.Mutation.createPost(
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

    assert.equal(result.id, "501");
    assert.equal(result.title, "Test Book");
    assert.equal(result.category, "BOOK");

    assert.ok(notificationArgs);
    assert.equal(notificationArgs.authorId, "162");
    assert.equal(notificationArgs.post.id, "501");
    assert.equal(notificationArgs.post.category, "BOOK");
  } finally {
    notificationEventService.notifyPostCreated = originalNotify;
    mock.restoreAll();
    void originalQuery;
    void originalDel;
  }
});


test("Redis cache invalidation failure does not block PostCreated notification", async () => {
  const originalNotify = notificationEventService.notifyPostCreated;
  let notificationCalled = false;

  mock.method(pool, "query", async () => ({
    rows: [
      {
        id: "502",
        title: "Redis Failure Book",
        category: "BOOK",
        description: "Test description",
        image_url: null,
        location: "Test Location",
        is_deleted: false,
        created_at: "2026-10-05T11:00:00.000Z",
        updated_at: "2026-10-05T11:00:00.000Z",
        user_id: "162",
      },
    ],
  }));

  mock.method(redis, "del", async () => {
    throw new Error("Redis unavailable");
  });

  notificationEventService.notifyPostCreated = async (post, authorId) => {
    notificationCalled = true;
    assert.equal(post.id, "502");
    assert.equal(authorId, "162");
    return { delivered: true, eventId: "redis-failure-test-event" };
  };

  try {
    const result = await resolvers.Mutation.createPost(
      null,
      {
        title: "Redis Failure Book",
        category: "BOOK",
        description: "Test description",
        imageUrl: null,
        location: "Test Location",
      },
      {
        user: { id: "162" },
      },
    );

    assert.equal(result.id, "502");
    assert.equal(notificationCalled, true);
  } finally {
    notificationEventService.notifyPostCreated = originalNotify;
    mock.restoreAll();
  }
});

test("failed post creation does not trigger PostCreated notification", async () => {
  const originalNotify = notificationEventService.notifyPostCreated;
  let notificationCalled = false;

  mock.method(pool, "query", async () => {
    throw new Error("database insert failed");
  });

  notificationEventService.notifyPostCreated = async () => {
    notificationCalled = true;
    return { delivered: true };
  };

  try {
    await assert.rejects(
      resolvers.Mutation.createPost(
        null,
        {
          title: "Failed Book",
          category: "BOOK",
          description: "Test description",
          imageUrl: null,
          location: "Test Location",
        },
        {
          user: { id: "162" },
        },
      ),
      /database insert failed/,
    );

    assert.equal(notificationCalled, false);
  } finally {
    notificationEventService.notifyPostCreated = originalNotify;
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
