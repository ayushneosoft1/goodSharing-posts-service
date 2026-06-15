import { pool } from "../db.js";
import { sendPushNotifications } from "./pushService.js";

export const notificationService = {
  async sendCategoryNotifications(post) {
    try {
      // STEP 1: Get users subscribed to this category
      const { rows: users } = await pool.query(
        `
        SELECT user_id
        FROM user_subscriptions
        WHERE category = $1
        `,
        [post.category],
      );

      if (!users.length) return;

      const userIds = users.map((u) => u.user_id);

      // STEP 2: Get push tokens
      const { rows: tokens } = await pool.query(
        `
        SELECT push_token
        FROM user_push_tokens
        WHERE user_id = ANY($1)
        `,
        [userIds],
      );

      if (!tokens.length) return;

      // STEP 3: Build Expo messages
      const messages = tokens.map((t) => ({
        to: t.push_token,
        sound: "default",
        title: `New ${post.category} post`,
        body: post.title,
        data: {
          postId: post.id,
        },
      }));

      // STEP 4: Send push notification
      await sendPushNotifications(messages);

      // STEP 5: Save DB notification (you already have logic elsewhere)
      await pool.query(
        `
        INSERT INTO notifications (user_id, post_id, title, message, is_read)
        SELECT unnest($1::uuid[]), $2, $3, $4, false
        `,
        [userIds, post.id, post.title, post.description],
      );
    } catch (err) {
      console.error("sendCategoryNotifications error:", err);
    }
  },
};
