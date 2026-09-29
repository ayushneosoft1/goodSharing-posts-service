import { Expo } from "expo-server-sdk";

const expo = new Expo();

export async function sendPushNotification(token, title, body, postId) {
  try {
    if (!Expo.isExpoPushToken(token)) {
      return;
    }

    const messages = [
      {
        to: token,
        sound: "default",
        title,
        body,
        data: {
          postId,
        },
      },
    ];

    const tickets = await expo.sendPushNotificationsAsync(messages);


    return tickets;
  } catch (err) {
    console.error("Push Service Error:", err);
    return null;
  }
}
