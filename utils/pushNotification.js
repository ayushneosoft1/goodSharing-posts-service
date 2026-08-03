import { Expo } from "expo-server-sdk";

const expo = new Expo();

export async function sendPushNotification(token, title, body, postId) {
  try {
    if (!Expo.isExpoPushToken(token)) {
      console.log("Invalid Expo push token:", token);
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

    console.log("Expo Push Response:", tickets);

    return tickets;
  } catch (err) {
    console.error("Push Service Error:", err);
    return null;
  }
}
