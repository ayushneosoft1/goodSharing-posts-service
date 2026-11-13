import crypto from "node:crypto";

const CATEGORY_IDS = {
  BOOK: "1",
  CLOTH: "2",
  ELECTRONIC: "3",
  TOYS: "4",
};

function getTimeoutMs() {
  const value = Number(process.env.NOTIFICATION_EVENT_TIMEOUT_MS || 5000);
  return Number.isFinite(value) && value > 0 ? value : 5000;
}

export function buildPostCreatedEvent(post, authorId, eventId = crypto.randomUUID()) {
  const categoryId = CATEGORY_IDS[post.category];

  if (!categoryId) {
    throw new Error("Invalid PostCreated category");
  }

  return {
    eventId,
    eventType: "PostCreated",
    postId: String(post.id),
    authorId: String(authorId),
    categoryId,
    title: String(post.title),
    createdAt: new Date(post.createdAt).toISOString(),
  };
}

export async function sendPostCreatedEvent(event) {
  const baseUrl = process.env.NOTIFICATION_SERVICE_URL;
  const authToken = process.env.INTERNAL_EVENT_AUTH_TOKEN;

  if (!baseUrl || !authToken) {
    throw new Error("PostCreated notification configuration is missing");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/internal/events/post-created`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-event-token": authToken,
        },
        body: JSON.stringify(event),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`Notification Service returned HTTP ${response.status}`);
    }

    return { delivered: true, eventId: event.eventId };
  } finally {
    clearTimeout(timeout);
  }
}
