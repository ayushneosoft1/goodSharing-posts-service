import { pool } from "../db.js";
import { redis } from "../redis.js";

const CACHE_TTL = 604800; // 7 days

function normalize(category) {
  return category?.trim();
}

function normalizeList(categories) {
  if (!Array.isArray(categories)) {
    throw new Error("Categories must be an array");
  }

  const cleaned = categories.map(normalize).filter(Boolean);

  const unique = [...new Set(cleaned)];

  if (unique.length === 0) {
    throw new Error("Select at least one category");
  }

  return unique;
}

async function clearSubscriptionCache(userId) {
  await redis.del(`subscriptions:${userId}`);
}

export const subscriptionService = {
  async getUserSubscriptions(userId) {
    try {
      const cacheKey = `subscriptions:${userId}`;

      const cached = await redis.get(cacheKey);

      if (cached) {
        console.log("Subscription Cache HIT");

        return JSON.parse(cached);
      }

      console.log("Subscription Cache MISS");

      const { rows } = await pool.query(
        `
        SELECT category
        FROM category_subscriptions
        WHERE user_id=$1
        ORDER BY category ASC
        `,
        [userId],
      );

      const subscriptions = rows.map((r) => r.category);

      await redis.set(cacheKey, JSON.stringify(subscriptions), "EX", CACHE_TTL);

      return subscriptions;
    } catch (err) {
      console.error("Get Subscription Error:", err);

      throw new Error("Failed to fetch subscriptions");
    }
  },

  async getUsersByCategory(category) {
    try {
      const cleaned = normalize(category);

      if (!cleaned) {
        return [];
      }

      const { rows } = await pool.query(
        `
        SELECT user_id AS id
        FROM category_subscriptions
        WHERE category=$1
        `,
        [cleaned],
      );

      return rows;
    } catch (err) {
      console.error("Get Users By Category Error:", err);

      return [];
    }
  },

  async subscribeCategories(userId, categories) {
    const client = await pool.connect();

    try {
      const uniqueCategories = normalizeList(categories);

      await client.query("BEGIN");

      for (const category of uniqueCategories) {
        await client.query(
          `
          INSERT INTO category_subscriptions
          (
            user_id,
            category
          )
          VALUES($1,$2)

          ON CONFLICT
          (
            user_id,
            category
          )
          DO NOTHING
          `,
          [userId, category],
        );
      }

      await client.query("COMMIT");

      await clearSubscriptionCache(userId);

      return true;
    } catch (err) {
      await client.query("ROLLBACK");

      console.error("Subscribe Categories Error:", err);

      throw new Error("Failed to subscribe categories");
    } finally {
      client.release();
    }
  },

  async updateSubscriptions(userId, categories) {
    const client = await pool.connect();

    try {
      const uniqueCategories = normalizeList(categories);

      await client.query("BEGIN");

      await client.query(
        `
        DELETE
        FROM category_subscriptions
        WHERE user_id=$1
        `,
        [userId],
      );

      for (const category of uniqueCategories) {
        await client.query(
          `
          INSERT INTO category_subscriptions
          (
            user_id,
            category
          )
          VALUES($1,$2)

          ON CONFLICT
          (
            user_id,
            category
          )
          DO NOTHING
          `,
          [userId, category],
        );
      }

      await client.query("COMMIT");

      await clearSubscriptionCache(userId);

      return true;
    } catch (err) {
      await client.query("ROLLBACK");

      console.error("Update Subscription Error:", err);

      throw new Error("Failed to update subscriptions");
    } finally {
      client.release();
    }
  },

  async unsubscribeCategory(userId, category) {
    try {
      const cleaned = normalize(category);

      if (!cleaned) {
        throw new Error("Invalid category");
      }

      const { rowCount } = await pool.query(
        `
        DELETE
        FROM category_subscriptions
        WHERE user_id=$1
        AND category=$2
        `,
        [userId, cleaned],
      );

      await clearSubscriptionCache(userId);

      return rowCount > 0;
    } catch (err) {
      console.error("Unsubscribe Error:", err);

      throw new Error("Failed to unsubscribe category");
    }
  },
};
