import { Expo } from "expo-server-sdk";

const expo = new Expo();

export async function sendPushNotification(token, title, body, postId) {
  await expo.sendPushNotificationsAsync([
    {
      to: token,
      sound: "default",
      title,
      body,
      data: {
        postId,
      },
    },
  ]);
}
