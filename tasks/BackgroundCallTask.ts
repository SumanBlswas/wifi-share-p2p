import { CallKeepService } from "@/services/CallKeepService";
import * as Notifications from "expo-notifications";

/**
 * BackgroundCallTask
 * This script runs in the background when an Expo Push Notification is received.
 * It's responsible for waking up CallKeep to show the system-level call UI.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function handleBackgroundNotification(
  notification: Notifications.Notification,
) {
  const data = notification.request.content.data as any;

  if (data && data.type === "incoming_call") {
    const { fromName, fromId, callId, sdp } = data;

    console.log("[Background] Receiving call from:", fromName);

    // 1. Trigger System Call UI (CallKeep)
    CallKeepService.displayIncomingCall(callId, fromId, fromName);
  }
}
