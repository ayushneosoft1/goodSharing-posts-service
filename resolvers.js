import { pool } from "./db.js";

export const resolvers = {
  Query: {
    async getPostDetails(_, { postId }) {
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
        [postId]
      );

      if (!rows[0]) return null;

      const post = rows[0];

      return {
        id: post.id,
        title: post.title,
        category: post.category,
        description: post.description,
        isDeleted: post.is_deleted,
        createdAt: post.created_at,
        updatedAt: post.updated_at,
        user_id: post.user_id,
      };
    },
  },

  Mutation: {
    async createPost(_, { title, category, description }, context) {
      // user comes from gateway auth
      if (!context.user) {
        throw new Error("Unauthorized");
      }

      const { rows } = await pool.query(
        `INSERT INTO posts (title, category, description, user_id)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [title, category, description, context.user.id]
      );

      const post = rows[0];

      return {
        id: post.id,
        title: post.title,
        category: post.category,
        description: post.description,
        isDeleted: post.is_deleted,
        createdAt: post.created_at,
        updatedAt: post.updated_at,
        user_id: post.user_id,
      };
    },
  },

  Post: {
    user(post) {
      return {
        __typename: "User",
        id: post.user_id,
      };
    },
  },
};
