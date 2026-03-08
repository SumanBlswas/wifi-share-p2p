import { UIEvents } from "@/utils/UIEvents";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getMessaging,
  getToken,
  onMessage,
  setBackgroundMessageHandler,
} from "@react-native-firebase/messaging";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { CallKeepService } from "./CallKeepService";
import { CallService } from "./CallService";
import { GlobalSigClient } from "./GlobalSigClient";

/**
 * PushNotificationService
 * Handles Expo Push Token registration and background notification listeners.
 */
class PushNotificationServiceClass {
  private isInitialized = false;

  constructor() {
    // B. FIREBASE BACKGROUND MESSAGE HANDLER (CRITICAL FOR CLOSED APP)
    // Register this AS EARLY AS POSSIBLE (Standalone modular SDK call)
    try {
      setBackgroundMessageHandler(getMessaging(), async (remoteMessage) => {
        console.log(
          "[Push] 🌙 Received FCM Background Message:",
          remoteMessage.data,
        );
        const data = remoteMessage.data;

        // Added check to ignore signals from self
        const myId = await AsyncStorage.getItem("@user_id");
        if (myId && data && data.fromId === myId) {
          console.log(`[Push] 🤫 Ignoring reflected ${data.type} from self`);
          return;
        }

        if (data && data.type === "call-offer") {
          // BUSY CHECK: If we are already in a call, ignore push offers
          const isBusy = await AsyncStorage.getItem("@is_calling_active");
          if (isBusy === "true") {
            console.log(
              "[Push] 📵 App is BUSY (active call). Ignoring background call-offer.",
            );
            return;
          }

          console.log(
            "[Push] 📞 Triggering CallKeep for background call from:",
            data.from,
          );

          // Acknowledge receipt even if app is closed/backgrounded
          try {
            const myName = await AsyncStorage.getItem("@user_name");
            if (myId && myName) {
              console.log("[Push] 🔔 Sending 'ringing' ack back to caller...");
              CallService.sendSignal(data.fromId as string, {
                type: "call-ringing",
                callId: data.callId as string,
                from: myName,
                fromId: myId,
              });
            }
          } catch (e) {
            console.warn("[Push] Failed to send ringing ack:", e);
          }

          Notifications.scheduleNotificationAsync({
            content: {
              title: `Incoming ${data.callType || "video"} Call`,
              body: `${data.from || "Someone"} is calling you...`,
              data: data as any,
              sound: true,
              priority: Notifications.AndroidNotificationPriority.MAX,
              categoryIdentifier: "incoming-call",
            },
            trigger: null,
          });
          CallKeepService.displayIncomingCall(
            (data.callId as string) || `call-${Date.now()}`,
            (data.fromId as string) || "unknown",
            (data.from as string) || "Incoming Call",
            data,
          );
        }
      });
    } catch (e) {
      console.warn("[Push] Error setting background message handler:", e);
    }
  }

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
      console.log("[Push] Failed to get push token!");
      return;
    }

    try {
      let finalToken = (await Notifications.getExpoPushTokenAsync()).data;
      console.log("[Push] Expo Push Token:", finalToken);

      if (Platform.OS === "android") {
        try {
          const fcmToken = await getToken(getMessaging());
          if (fcmToken) {
            console.log("[Push] Native FCM Token:", fcmToken);
            finalToken = fcmToken; // Use native FCM for Android background reliability
          }
        } catch (fcmError) {
          console.warn(
            "[Push] FCM Token fetch failed, falling back to Expo:",
            fcmError,
          );
        }

        Notifications.setNotificationChannelAsync("default", {
          name: "default",
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#FF231F7C",
        });
      }

      GlobalSigClient.registerPushToken(userId, finalToken);
    } catch (e) {
      console.log("[Push] Error getting tokens:", e);
    }
  }

  setupBackgroundHandlers() {
    if (this.isInitialized) return;

    Notifications.setNotificationCategoryAsync("incoming-call", [
      {
        identifier: "answer",
        buttonTitle: "Answer",
        options: { opensAppToForeground: true },
      },
      {
        identifier: "decline",
        buttonTitle: "Decline",
        options: { isDestructive: true },
      },
    ]);

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldVibrate: true,
        shouldSetBadge: false,
      }),
    });

    Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (response.actionIdentifier === "answer") {
        UIEvents.emit("CALLKEEP_ANSWER", data);
      } else if (response.actionIdentifier === "decline") {
        UIEvents.emit("CALLKEEP_END", data);
      }
    });

    // C. FIREBASE FOREGROUND MESSAGE HANDLER
    try {
      onMessage(getMessaging(), async (remoteMessage) => {
        console.log(
          "[Push] ☀️ Received FCM Foreground Message:",
          remoteMessage,
        );
      });
    } catch (e) {
      console.warn("[Push] Error setting foreground message handler:", e);
    }

    this.isInitialized = true;
  }

  async showOngoingCallNotification(peerName: string, callType: string) {
    await Notifications.scheduleNotificationAsync({
      identifier: "ongoing-call",
      content: {
        title: `📞 Active ${callType} Call`,
        body: `Talking with ${peerName}`,
        sticky: true,
        priority: Notifications.AndroidNotificationPriority.LOW,
      },
      trigger: null,
    });
  }

  async dismissOngoingCallNotification() {
    await Notifications.dismissNotificationAsync("ongoing-call");
    await Notifications.dismissNotificationAsync("incoming-call");
  }
}

export const PushNotificationService = new PushNotificationServiceClass();
