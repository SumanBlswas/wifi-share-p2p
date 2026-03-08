import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { GlobalSigClient } from "./GlobalSigClient";

/**
 * PushNotificationService
 * Handles Expo Push Token registration and background notification listeners.
 * This is the key to waking up the app when it's closed.
 */
class PushNotificationServiceClass {
  private isInitialized = false;

  async registerForPushNotificationsAsync(userId: string) {
    if (!Device.isDevice) {
      console.log("[Push] Must use physical device for push notifications");
      return;
    }

    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.log("[Push] Failed to get push token for push notification!");
      return;
    }

    try {
      const token = (await Notifications.getExpoPushTokenAsync()).data;
      console.log("[Push] Expo Push Token:", token);

      if (Platform.OS === "android") {
        Notifications.setNotificationChannelAsync("default", {
          name: "default",
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#FF231F7C",
        });
      }

      // Send token to our Render backend
      GlobalSigClient.registerPushToken(userId, token);
    } catch (e) {
      console.log(
        "[Push] Could not get push token. Firebase may not be configured:",
        e,
      );
    }
  }

  setupBackgroundHandlers() {
    if (this.isInitialized) return;

    // This listener fires when a user taps on or interacts with a notification
    Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      console.log("[Push] Notification interaction:", data);
      // Handle incoming call navigation if data contains call info
    });

    this.isInitialized = true;
  }
}

export const PushNotificationService = new PushNotificationServiceClass();
