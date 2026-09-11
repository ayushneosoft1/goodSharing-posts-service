import { pool } from "./db.js";
import { redis } from "./redis.js";
import GraphQLJSON from "graphql-type-json";
import { notificationService } from "./services/notificationService.js";
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

      // Invalidate both list + single post cache
      await Promise.all([
        redis.del("posts:all:v1"),
        redis.del(`post:${post.id}`),
      ]);

      // Existing legacy notification/category notification logic.
      // Do not expand or reconnect this flow as part of M3.
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

        // Get target users from legacy notifications table
        // (excluding post creator).
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
          // Fetch Expo push tokens from user-service.
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
  },

  Post: {
    owner(parent) {
      return {
        __typename: "User",
        id: parent.user_id,
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
