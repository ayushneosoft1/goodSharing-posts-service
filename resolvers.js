import { pool } from "./db.js";
import { redis } from "./redis.js";
import GraphQLJSON from "graphql-type-json";
import { notificationService } from "./services/notificationService.js";
import { subscriptionService } from "./services/subscriptionService.js";
import { sendPushNotification } from "./utils/pushNotification.js";
import { request, gql } from "graphql-request";

const USER_SERVICE_URL =
  "http://user-service.services.svc.cluster.local:4001/graphql";

const CACHE_TTL = 604800;

export const resolvers = {
  JSON: GraphQLJSON,

  Query: {
    async getPostDetails(_, { postId }, context) {
      if (!context?.user) throw new Error("Unauthorized");

      const cacheKey = `post:${postId}`;

      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      const { rows } = await pool.query(
        `
        SELECT *
        FROM posts
        WHERE id=$1 AND is_deleted=false
        `,
        [postId],
      );

      if (!rows.length) return null;

      const post = mapPost(rows[0]);

      await redis.set(cacheKey, JSON.stringify(post), "EX", CACHE_TTL);

      return post;
    },

    async posts(_, __, context) {
      console.log("==================================");
      console.log("LOCAL POSTS RESOLVER HIT");
      console.log("Authenticated User:", context.user);
      console.log("==================================");
      if (!context?.user) throw new Error("Unauthorized");

      const cacheKey = "posts:all:v1";

      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      const { rows } = await pool.query(
        `
        SELECT *
        FROM posts
        WHERE is_deleted=false
        ORDER BY created_at DESC
        LIMIT 50
        `,
      );

      const posts = rows.map(mapPost);

      await redis.set(cacheKey, JSON.stringify(posts), "EX", CACHE_TTL);

      return posts;
    },

    async notifications(_, { limit = 10, offset = 0 }, context) {
      if (!context?.user) throw new Error("Unauthorized");

      const notifications = await notificationService.getUserNotifications(
        context.user.id,
        limit,
        offset,
      );

      return notifications.map((n) => ({
        id: n.id,
        userId: n.user_id,
        postId: n.post_id,
        title: n.title,
        message: n.message,
        isRead: n.is_read,
        createdAt: n.created_at,
      }));
    },

    async notification(_, { id }, context) {
      if (!context?.user) throw new Error("Unauthorized");

      const { rows } = await pool.query(
        `
SELECT *
FROM notifications
WHERE id=$1
AND user_id = $2
`,
        [id, context.user.id],
      );

      const n = rows[0];
      if (!n) return null;

      return {
        id: n.id,
        userId: n.user_id,
        postId: n.post_id,
        title: n.title,
        message: n.message,
        isRead: n.is_read,
        createdAt: n.created_at,
      };
    },

    async mySubscriptions(_, __, context) {
      if (!context?.user) throw new Error("Unauthorized");

      return subscriptionService.getUserSubscriptions(context.user.id);
    },

    async unreadNotificationCount(_, __, context) {
      if (!context?.user) throw new Error("Unauthorized");

      return notificationService.getUnreadNotificationCount(context.user.id);
    },

    async testPostCache(_, { postId }, context) {
      if (!context?.user) throw new Error("Unauthorized");

      const cacheKey = `post:${postId}`;

      const cached = await redis.get(cacheKey);

      return {
        cacheKey,
        ttl: await redis.ttl(cacheKey),
        cachedData: cached ? JSON.parse(cached) : null,
      };
    },
  },

  Mutation: {
    async createPost(
      _,
      { title, category, description, imageUrl, location },
      context,
    ) {
      if (!context?.user) throw new Error("Unauthorized");

      if (!title || title.trim().length < 3) {
        throw new Error("Invalid title");
      }

      const { rows } = await pool.query(
        `
        INSERT INTO posts(
          title,
          category,
          description,
          image_url,
          location,
          user_id
        )
        VALUES($1,$2,$3,$4,$5,$6)
        RETURNING *
        `,
        [
          title,
          category,
          description,
          imageUrl || null,
          location || null,
          context.user.id,
        ],
      );

      const post = mapPost(rows[0]);

      // FIX: invalidate both list + single post cache
      // FIX: invalidate both list + single post cache
      await Promise.all([
        redis.del("posts:all:v1"),
        redis.del(`post:${post.id}`),
      ]);

      // Existing in-app/category notifications
      await notificationService.sendCategoryNotifications(post);

      // ======================
      // PUSH NOTIFICATION
      // ======================

      try {
        const GET_PUSH_TOKENS = gql`
          query GetPushTokens($userIds: [ID!]!) {
            getPushTokens(userIds: $userIds) {
              userId
              pushToken
            }
          }
        `;

        // Get target users from notifications table (excluding post creator)
        const { rows: userRows } = await pool.query(
          `
    SELECT DISTINCT user_id
    FROM notifications
    WHERE user_id != $1
    `,
          [context.user.id],
        );

        const userIds = userRows.map((u) => String(u.user_id));

        console.log("TARGET USER IDS =>", userIds);

        if (userIds.length === 0) {
          console.log("NO TARGET USERS FOR PUSH");
        } else {
          // Fetch Expo push tokens from user-service
          const data = await request(USER_SERVICE_URL, GET_PUSH_TOKENS, {
            userIds,
          });

          const users = data.getPushTokens || [];

          console.log("PUSH USERS COUNT =>", users.length);
          console.log("PUSH USERS =>", users);

          for (const user of users) {
            try {
              console.log("Sending push to =>", user.pushToken);

              const result = await sendPushNotification(
                user.pushToken,
                "New Post Added",
                post.title,
                post.id,
              );

              console.log("PUSH RESULT =>", result);
            } catch (err) {
              console.error("Push send failed for user", user.userId, err);
            }
          }
        }
      } catch (err) {
        console.error("Failed to fetch push tokens from user-service:", err);
      }

      return post;
    },

    async subscribeCategories(_, { categories }, context) {
      if (!context?.user) throw new Error("Unauthorized");

      if (!Array.isArray(categories) || categories.length === 0) {
        throw new Error("Select at least one category");
      }

      return subscriptionService.subscribeCategories(
        context.user.id,
        categories,
      );
    },

    async updateSubscriptions(_, { categories }, context) {
      if (!context?.user) throw new Error("Unauthorized");

      return subscriptionService.updateSubscriptions(
        context.user.id,
        categories,
      );
    },

    async unsubscribeCategory(_, { category }, context) {
      if (!context?.user) throw new Error("Unauthorized");

      return subscriptionService.unsubscribeCategory(context.user.id, category);
    },

    async markNotificationRead(_, { notificationId }, context) {
      if (!context?.user) throw new Error("Unauthorized");

      return notificationService.markNotificationRead(
        context.user.id,
        notificationId,
      );
    },

    async markAllNotificationsRead(_, __, context) {
      if (!context?.user) throw new Error("Unauthorized");

      await pool.query(
        `
        UPDATE notifications
        SET is_read=true
        WHERE user_id=$1
        `,
        [context.user.id],
      );

      await Promise.all([
        redis.del(`notifications:${context.user.id}`),
        redis.del(`notificationCount:${context.user.id}`),
      ]);

      return true;
    },
  },

  Post: {
    owner(parent) {
      return {
        __typename: "User",
        id: parent.user_id,
      };
    },
  },

  Notification: {
    post(parent) {
      if (!parent.post_id) return null;

      return {
        __typename: "Post",
        id: parent.post_id,
      };
    },
  },
};

function mapPost(post = {}) {
  return {
    id: post.id,
    title: post.title,
    category: post.category,
    description: post.description,
    imageUrl: post.image_url,
    location: post.location,
    isDeleted: post.is_deleted,
    createdAt: post.created_at,
    updatedAt: post.updated_at,
    user_id: post.user_id,
  };
}
