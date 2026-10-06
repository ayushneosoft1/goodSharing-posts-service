import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { notifyPostCreated } from "../services/notificationEventService.js";

test("successful post creation event sends the required PostCreated payload", async () => {
  const received = {};

  const server = http.createServer((req, res) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      received.method = req.method;
      received.url = req.url;
      received.auth = req.headers["x-internal-event-token"];
      received.body = JSON.parse(body);

      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const port = server.address().port;

    process.env.NOTIFICATION_SERVICE_URL = `http://127.0.0.1:${port}`;
    process.env.INTERNAL_EVENT_AUTH_TOKEN = "test-token";
    process.env.NOTIFICATION_EVENT_TIMEOUT_MS = "5000";

    const result = await notifyPostCreated(
      {
        id: "101",
        title: "Test Book",
        category: "BOOK",
        createdAt: "2026-10-05T10:00:00.000Z",
      },
      "162",
    );

    assert.equal(result.delivered, true);
    assert.equal(received.method, "POST");
    assert.equal(received.url, "/internal/events/post-created");
    assert.equal(received.auth, "test-token");

    assert.equal(received.body.eventType, "PostCreated");
    assert.equal(received.body.postId, "101");
    assert.equal(received.body.authorId, "162");
    assert.equal(received.body.categoryId, "1");
    assert.equal(received.body.title, "Test Book");
    assert.equal(received.body.createdAt, "2026-10-05T10:00:00.000Z");
    assert.match(received.body.eventId, /^[0-9a-f-]{36}$/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("notification service failure does not throw", async () => {
  process.env.NOTIFICATION_SERVICE_URL = "http://127.0.0.1:59999"
  process.env.INTERNAL_EVENT_AUTH_TOKEN = "test-token";
  process.env.NOTIFICATION_EVENT_TIMEOUT_MS = "1000";

  const result = await notifyPostCreated(
    {
      id: "102",
      title: "Failure Test",
      category: "BOOK",
      createdAt: "2026-10-05T10:00:00.000Z",
    },
    "165",
  );

  assert.equal(result.delivered, false);
  assert.ok(result.eventId);
});

test("invalid category does not send an event", async () => {
  process.env.NOTIFICATION_SERVICE_URL = "http://127.0.0.1:59999"
  process.env.INTERNAL_EVENT_AUTH_TOKEN = "test-token";

  const result = await notifyPostCreated(
    {
      id: "103",
      title: "Invalid Category",
      category: "UNKNOWN",
      createdAt: "2026-10-05T10:00:00.000Z",
    },
    "165",
  );

  assert.equal(result.delivered, false);
});
