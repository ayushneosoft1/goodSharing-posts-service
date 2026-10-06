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

export async function notifyPostCreated(post, authorId) {
  const baseUrl = process.env.NOTIFICATION_SERVICE_URL;
  const authToken = process.env.INTERNAL_EVENT_AUTH_TOKEN;

  if (!baseUrl || !authToken) {
    console.error("POST_CREATED_NOTIFICATION_CONFIG_MISSING", {
      postId: String(post.id),
    });
    return { delivered: false };
  }

  const categoryId = CATEGORY_IDS[post.category];

  if (!categoryId) {
    console.error("POST_CREATED_NOTIFICATION_INVALID_CATEGORY", {
      postId: String(post.id),
      category: post.category,
    });
    return { delivered: false };
  }

  const event = {
    eventId: crypto.randomUUID(),
    eventType: "PostCreated",
    postId: String(post.id),
    authorId: String(authorId),
    categoryId,
    title: String(post.title),
    createdAt: new Date(post.createdAt).toISOString(),
  };

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
      console.error("POST_CREATED_NOTIFICATION_FAILED", {
        eventId: event.eventId,
        postId: event.postId,
        status: response.status,
      });
      return { delivered: false, eventId: event.eventId };
    }

    return { delivered: true, eventId: event.eventId };
  } catch (error) {
    console.error("POST_CREATED_NOTIFICATION_FAILED", {
      eventId: event.eventId,
      postId: event.postId,
      error: error?.name === "AbortError" ? "timeout" : error?.message,
    });
    return { delivered: false, eventId: event.eventId };
  } finally {
    clearTimeout(timeout);
  }
}

export const notificationEventService = { notifyPostCreated };
