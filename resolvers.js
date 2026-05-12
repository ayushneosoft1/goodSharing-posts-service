import { pool } from "./db.js";
import { redis } from "./redis.js";

const CACHE_TTL = 604800; // 7 days

export const resolvers = {
  Query: {
    // ✅ 1. Get Single Post
    async getPostDetails(_, { postId }, context) {
      if (!context.user) {
        throw new Error("Unauthorized");
      }

      const cacheKey = `post:${postId}`;

      // 🔹 Check Redis
      const cached = await redis.get(cacheKey);
      if (cached) {
        console.log("✅ Cache HIT:", cacheKey);
        return JSON.parse(cached);
      }

      console.log("❌ Cache MISS:", cacheKey);

      // 🔹 Fetch from DB
      const { rows } = await pool.query(
        `SELECT * FROM public.posts 
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
        imageUrl: post.image_url,
        location: post.location,
        isDeleted: post.is_deleted,
        createdAt: post.created_at,
        updatedAt: post.updated_at,
        user_id: post.user_id, // 🔥 IMPORTANT
      };

      // 🔹 Store in Redis
      try {
        await redis.set(cacheKey, JSON.stringify(postData), "EX", CACHE_TTL);
        console.log("📦 Stored in Redis:", cacheKey);
      } catch (err) {
        console.error("Redis set error:", err);
      }

      return postData;
    },

    // ✅ 2. Get All Posts
    async posts(_, __, context) {
      if (!context.user) {
        throw new Error("Unauthorized");
      }

      const cacheKey = "posts:all";

      // 🔹 Check Redis
      const cached = await redis.get(cacheKey);
      if (cached) {
        console.log("✅ POSTS Cache HIT");
        return JSON.parse(cached);
      }

      console.log("❌ POSTS Cache MISS");

      // 🔹 Fetch from DB
      const { rows } = await pool.query(`
        SELECT * FROM posts
        WHERE is_deleted = false
        ORDER BY created_at DESC
      `);

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

      // 🔹 Store in Redis
      try {
        await redis.set(cacheKey, JSON.stringify(posts), "EX", CACHE_TTL);
        console.log("📦 Cached posts list");
      } catch (err) {
        console.error("Redis error:", err);
      }

      return posts;
    },

    // ✅ 3. Debug Cache
    async testPostCache(_, { postId }, context) {
      if (!context.user) {
        throw new Error("Unauthorized");
      }

      const cacheKey = `post:${postId}`;

      const ttl = await redis.ttl(cacheKey);
      const data = await redis.get(cacheKey);

      return {
        cacheKey,
        ttl,
        cachedData: data ? JSON.parse(data) : null,
      };
    },
  },

  Mutation: {
    // ✅ 4. Create Post
    async createPost(
      _,
      { title, category, description, imageUrl, location },
      context,
    ) {
      if (!context.user) {
        throw new Error("Unauthorized");
      }

      try {
        const { rows } = await pool.query(
          `INSERT INTO public.posts 
           (title, category, description, image_url, location, user_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [
            title,
            category,
            description,
            imageUrl || null,
            location || null,
            context.user.id,
          ],
        );

        const post = rows[0];

        const postData = {
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

        const cacheKey = `post:${post.id}`;

        // 🔹 Cache single post
        await redis.set(cacheKey, JSON.stringify(postData), "EX", CACHE_TTL);

        // 🔹 Invalidate list cache
        await redis.del("posts:all");

        console.log("✅ Post created + cache updated");

        return postData;
      } catch (err) {
        console.error("CreatePost Error:", err);
        throw new Error("Failed to create post");
      }
    },
  },

  // ✅🔥 MOST IMPORTANT FIX (OWNER RESOLVER)
  Post: {
    owner(parent) {
      return parent.user_id ? { __typename: "User", id: parent.user_id } : null;
    },
  },
};
