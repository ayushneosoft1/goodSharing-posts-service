import fetch from "node-fetch";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export async function sendPushNotifications(messages) {
  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });

    const result = await response.json();

    console.log("Expo Push Response:", result);

    return result;
  } catch (err) {
    console.error("Push Service Error:", err);
    return null;
  }
}
