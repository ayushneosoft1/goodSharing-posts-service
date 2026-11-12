import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import {
  buildPostCreatedEvent,
  sendPostCreatedEvent,
} from "../services/notificationEventService.js";

const originalEnv = {
  url: process.env.NOTIFICATION_SERVICE_URL,
  token: process.env.INTERNAL_EVENT_AUTH_TOKEN,
  timeout: process.env.NOTIFICATION_EVENT_TIMEOUT_MS,
};

function restoreEnv() {
  for (const [key, value] of [
    ["NOTIFICATION_SERVICE_URL", originalEnv.url],
    ["INTERNAL_EVENT_AUTH_TOKEN", originalEnv.token],
    ["NOTIFICATION_EVENT_TIMEOUT_MS", originalEnv.timeout],
  ]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function withServer(handler, run, timeoutMs = 2000) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  process.env.NOTIFICATION_SERVICE_URL =
    `http://127.0.0.1:${server.address().port}`;
  process.env.INTERNAL_EVENT_AUTH_TOKEN = "test-internal-token";
  process.env.NOTIFICATION_EVENT_TIMEOUT_MS = String(timeoutMs);

  try {
    await run();
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    restoreEnv();
  }
}

test("builds PostCreated events with the shared category IDs", () => {
  const expected = {
    BOOK: "1",
    CLOTH: "2",
    ELECTRONIC: "3",
    TOYS: "4",
  };

  for (const [category, categoryId] of Object.entries(expected)) {
    const event = buildPostCreatedEvent(
      {
        id: "501",
        title: "Test Post",
        category,
        createdAt: "2026-10-05T10:00:00.000Z",
      },
      "162",
      "stable-event-id",
    );

    assert.equal(event.categoryId, categoryId);
    assert.equal(event.eventId, "stable-event-id");
    assert.equal(event.eventType, "PostCreated");
  }
});

test("rejects an invalid PostCreated category", () => {
  assert.throws(
    () => buildPostCreatedEvent(
      {
        id: "501",
        title: "Invalid Category",
        category: "UNKNOWN",
        createdAt: "2026-10-05T10:00:00.000Z",
      },
      "162",
    ),
    /Invalid PostCreated category/,
  );
});

test("sends the required authenticated PostCreated HTTP payload", async () => {
  let receivedRequest;

  await withServer((req, res) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      receivedRequest = {
        method: req.method,
        url: req.url,
        token: req.headers["x-internal-event-token"],
        contentType: req.headers["content-type"],
        payload: JSON.parse(body),
      };

      res.writeHead(202, { "content-type": "application/json" });
      res.end("{}");
    });
  }, async () => {
    const event = buildPostCreatedEvent(
      {
        id: "501",
        title: "Test Book",
        category: "BOOK",
        createdAt: "2026-10-05T10:00:00.000Z",
      },
      "162",
      "stable-event-id",
    );

    const result = await sendPostCreatedEvent(event);

    assert.deepEqual(result, {
      delivered: true,
      eventId: "stable-event-id",
    });

    assert.deepEqual(receivedRequest, {
      method: "POST",
      url: "/internal/events/post-created",
      token: "test-internal-token",
      contentType: "application/json",
      payload: {
        eventId: "stable-event-id",
        eventType: "PostCreated",
        postId: "501",
        authorId: "162",
        categoryId: "1",
        title: "Test Book",
        createdAt: "2026-10-05T10:00:00.000Z",
      },
    });
  });
});

test("rejects non-success Notification Service HTTP responses", async () => {
  await withServer((_req, res) => {
    res.writeHead(503);
    res.end();
  }, async () => {
    await assert.rejects(
      sendPostCreatedEvent({ eventId: "stable-event-id" }),
      /Notification Service returned HTTP 503/,
    );
  });
});

test("aborts the Notification Service request when it times out", async () => {
  await withServer(() => {
    // Intentionally leave the request unanswered to trigger the timeout.
  }, async () => {
    await assert.rejects(
      sendPostCreatedEvent({ eventId: "stable-event-id" }),
      (error) => error.name === "AbortError",
    );
  }, 50);
});
