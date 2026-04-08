import { pool } from "./db.js";
import { redis } from "./redis.js";

const CACHE_TTL = 604800; // 7 days

export const resolvers = {
  Query: {
    //  1. Get Single Post
    async getPostDetails(_, { postId }, context) {
      if (!context.user) {
        throw new Error("Unauthorized");
      }

      const cacheKey = `post:${postId}`;

      // 1. Check Redis
      const redisData = await redis.get(cacheKey);

      if (redisData) {
        console.log(" Cache HIT:", cacheKey);
        return JSON.parse(redisData);
      }

      console.log(" Cache MISS:", cacheKey);

      // 2. Fetch from DB
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
         FROM  public. posts
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

      // 3. Store in Redis
      try {
        await redis.set(cacheKey, JSON.stringify(postData), "EX", CACHE_TTL);
        console.log(" Stored in Redis:", cacheKey);
      } catch (err) {
        console.error("Redis set error:", err);
      }

      return postData;
    },

    //  2. Get All Posts (NEW)
    async posts(_, __, context) {
      if (!context.user) {
        throw new Error("Unauthorized");
      }

      const cacheKey = "posts:all";

      // 1. Check Redis
      const cached = await redis.get(cacheKey);
      if (cached) {
        console.log(" POSTS Cache HIT");
        return JSON.parse(cached);
      }

      console.log(" POSTS Cache MISS");

      // 2. Fetch from DB
      const { rows } = await pool.query(`
        SELECT
          id,
          title,
          category,
          description,
          image_url,
          location,
          is_deleted,
          created_at,
          updated_at,
          user_id
        FROM posts
        WHERE is_deleted = false
        ORDER BY created_at DESC
      `);

      // 3. Map response
      const posts = rows.map((post) => ({
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
      }));

      // 4. Store in Redis
      try {
        await redis.set(cacheKey, JSON.stringify(posts), "EX", CACHE_TTL);
        console.log(" Cached posts list");
      } catch (err) {
        console.error("Redis error:", err);
      }

      return posts;
    },

    //  5. Debug Cache
    async testPostCache(_, { postId }, context) {
      if (!context.user) {
        throw new Error("Unauthorized");
      }
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
    //  Create Post
    async createPost(_, { title, category, description }, context) {
      if (!context.user) {
        throw new Error("Unauthorized : Token missing or invalid");
      }

      console.log("createPost called");
      console.log("User ID:", context.user.id);

      // 1. Insert into DB
      const { rows } = await pool.query(
        `INSERT INTO public.posts (title, category, description, user_id)
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

      const cacheKey = `post:${post.id}`;

      // 2. Cache single post
      try {
        await redis.set(cacheKey, JSON.stringify(postData), "EX", CACHE_TTL);
        console.log(" Post cached:", cacheKey);
      } catch (err) {
        console.error("Redis set error:", err);
      }

      //  3. Invalidate posts list cache
      try {
        await redis.del("posts:all");
        console.log("🧹 Cleared posts:all cache");
      } catch (err) {
        console.error("Redis delete error:", err);
      }

      return postData;
    },
  },

  //  IMPORTANT: match GraphQL schema (owner, not user)
  Post: {
    owner(post) {
      return { __typename: "User", id: String(post.user_id) };
    },
  },
};

// Redis connection log
redis.on("connect", () => {
  console.log(" Redis connected (post service)");
});
