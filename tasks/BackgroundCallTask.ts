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

  if (data && (data.type === "incoming_call" || data.type === "call-offer")) {
    const callId = (data.callId as string) || `call-${Date.now()}`;
    const fromId =
      (data.fromId as string) || (data.handle as string) || "unknown";
    const fromName =
      (data.from as string) ||
      (data.fromName as string) ||
      "Incoming Call";

    console.log("[Background] Receiving call from:", fromName);

    // 1. Trigger System Call UI (CallKeep)
    await CallKeepService.setup({ requestPermissions: false });
    CallKeepService.displayIncomingCall(callId, fromId, fromName, data);
  }
}
