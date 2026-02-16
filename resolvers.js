import { pool } from "./db.js";
import { redis } from "./redis.js";

const CACHE_TTL = 600; // 10 minutes

export const resolvers = {
  Query: {
    // 1. Get Post Details
    async getPostDetails(_, { postId }) {
      const cacheKey = `post:${postId}`;

      // 2. Check Redis first
      const redisData = await redis.get(cacheKey);

      if (redisData) {
        console.log("⚡ Cache HIT:", cacheKey);
        return JSON.parse(redisData);
      }

      console.log(" Cache MISS:", cacheKey);

      // 3. Fetch from DB
      const { rows } = await pool.query(
        `SELECT
           id,
           title,
           category,
           description,
           is_deleted,
           created_at,
           updated_at,
           user_id
         FROM posts
         WHERE id = $1 AND is_deleted = false`,
        [postId],
      );

      if (!rows[0]) return null;

      const post = rows[0];

      const postData = {
        id: post.id,
        title: post.title,
        category: post.category,
        description: post.description,
        isDeleted: post.is_deleted,
        createdAt: post.created_at,
        updatedAt: post.updated_at,
        user_id: post.user_id,
      };

      // 4. Store in Redis
      try {
        await redis.set(cacheKey, JSON.stringify(postData), "EX", CACHE_TTL);
        console.log(" Stored postdata in Redis:", cacheKey);
      } catch (err) {
        console.error("Redis set error:", err);
      }

      return postData;
    },

    // 5. Debug Cache API
    async testPostCache(_, { postId }) {
      const cacheKey = `post:${postId}`;

      const ttl = await redis.ttl(cacheKey);
      const data = await redis.get(cacheKey);

      console.log("TestPostCache:", { cacheKey, ttl, data });

      return {
        cacheKey,
        ttl,
        cachedData: data ? JSON.parse(data) : null,
      };
    },
  },

  Mutation: {
    // 1. Create Post
    async createPost(_, { title, category, description }, context) {
      if (!context.user) {
        throw new Error("Unauthorized");
      }

      console.log("createPost called");
      console.log("User ID:", context.user.id);

      // 2. Insert into DB
      const { rows } = await pool.query(
        `INSERT INTO posts (title, category, description, user_id)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [title, category, description, context.user.id],
      );

      const post = rows[0];

      const postData = {
        id: post.id,
        title: post.title,
        category: post.category,
        description: post.description,
        isDeleted: post.is_deleted,
        createdAt: post.created_at,
        updatedAt: post.updated_at,
        user_id: post.user_id,
      };

      //  DEFINE cacheKey here
      const cacheKey = `post:${post.id}`;

      // 3. Store immediately in Redis
      try {
        await redis.set(cacheKey, JSON.stringify(postData), "EX", CACHE_TTL);
        console.log(" Post cached:", cacheKey);
      } catch (err) {
        console.error("Redis set error:", err);
      }

      return postData;
    },
  },

  Post: {
    user(post) {
      return { __typename: "User", id: post.user_id };
    },
  },
};

// Redis connection log
redis.on("connect", () => {
  console.log(" Redis connected (post service)");
});
