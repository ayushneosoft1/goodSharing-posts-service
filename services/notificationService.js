import { pool } from "../db.js";
import { redis } from "../redis.js";

const CACHE_TTL = 604800; // 7 days

function toInt(value) {
  const n = Number(value);
  if (Number.isNaN(n)) {
    throw new Error("Invalid numeric value");
  }
  return n;
}

async function clearNotificationCache(userId) {
  const notificationKeys = await redis.keys(`notifications:${userId}:*`);

  await Promise.all([
    ...(notificationKeys.length ? [redis.del(...notificationKeys)] : []),

    redis.del(`notificationCount:${userId}`),
  ]);
}

export const notificationService = {
  async sendCategoryNotifications(post) {
    try {
      const { rows: subscribers } = await pool.query(
        `
        SELECT DISTINCT user_id
        FROM category_subscriptions
        WHERE category=$1
        `,
        [post.category],
      );

      if (!subscribers.length) return true;

      const authorId = toInt(post.user_id);

      const validSubscribers = subscribers.filter(
        (s) => toInt(s.user_id) !== authorId,
      );

      if (!validSubscribers.length) return true;

      await Promise.all(
        validSubscribers.map(async (subscriber) => {
          const userId = subscriber.user_id;

          await pool.query(
            `
            INSERT INTO notifications
              (user_id, post_id, title, message)
            VALUES ($1, $2, $3, $4)
            `,
            [
              userId,

              post.id,

              `${post.category} Update`,

              `${post.title} was uploaded in ${post.category}`,
            ],
          );

          await clearNotificationCache(userId);
        }),
      );

      return true;
    } catch (err) {
      console.error("Send Category Notification Error:", err);
      throw new Error("Failed to send category notifications");
    }
  },

  async getUserNotifications(userId, limit = 10, offset = 0) {
    try {
      const id = toInt(userId);
      const cacheKey = `notifications:${id}:${limit}:${offset}`;

      const cached = await redis.get(cacheKey);

      if (cached) {
        console.log("Notification Cache HIT");
        return JSON.parse(cached);
      }

      console.log("Notification Cache MISS");

      const { rows } = await pool.query(
        `
        SELECT *
        FROM notifications
        WHERE user_id=$1
        ORDER BY created_at DESC
        LIMIT $2
        OFFSET $3
        `,
        [id, limit, offset],
      );

      await redis.set(cacheKey, JSON.stringify(rows), "EX", CACHE_TTL);

      return rows;
    } catch (err) {
      console.error("Get Notifications Error:", err);
      return [];
    }
  },

  async getUnreadNotificationCount(userId) {
    try {
      const id = toInt(userId);
      const cacheKey = `notificationCount:${id}`;

      const cached = await redis.get(cacheKey);

      if (cached !== null) {
        console.log("Notification Count Cache HIT");
        return Number(cached);
      }

      console.log("Notification Count Cache MISS");

      const { rows } = await pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM notifications
        WHERE user_id=$1 AND is_read=false
        `,
        [id],
      );

      const count = rows[0]?.count || 0;

      await redis.set(cacheKey, count, "EX", CACHE_TTL);

      return count;
    } catch (err) {
      console.error("Unread Notification Count Error:", err);
      return 0;
    }
  },

  async markNotificationRead(userId, notificationId) {
    try {
      const uid = toInt(userId);
      const nid = toInt(notificationId);

      const { rows } = await pool.query(
        `
        SELECT id, user_id, is_read
        FROM notifications
        WHERE id=$1
        `,
        [nid],
      );

      if (!rows.length) {
        throw new Error("Notification not found");
      }

      const notification = rows[0];

      if (toInt(notification.user_id) !== uid) {
        throw new Error("Unauthorized access to notification");
      }

      if (notification.is_read) {
        return true;
      }

      await pool.query(
        `
        UPDATE notifications
        SET is_read=true
        WHERE id=$1
        `,
        [nid],
      );

      await clearNotificationCache(uid);

      return true;
    } catch (err) {
      console.error("Mark Notification Error:", err);
      throw new Error(err.message || "Failed to mark notification");
    }
  },
};
