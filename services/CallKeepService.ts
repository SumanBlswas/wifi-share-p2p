import { UIEvents } from "@/utils/UIEvents";
import { PermissionsAndroid, Platform } from "react-native";
import RNCallKeep from "react-native-callkeep";

/**
 * CallKeepService
 * Manages the native system-level calling UI (CallKit for iOS, ConnectionService for Android).
 * This allows calls to show on the lock screen and work when the app is in the background.
 */
class CallKeepServiceClass {
  private isInitialized = false;
  private pendingCallMetadata: { [uuid: string]: any } = {};

  async setup(setupOptions?: { requestPermissions?: boolean }) {
    if (this.isInitialized) return;

    const requestPermissions = setupOptions?.requestPermissions !== false;

    if (Platform.OS === "android" && requestPermissions) {
      try {
        const permissions = [
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          PermissionsAndroid.PERMISSIONS.CAMERA,
          PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
          PermissionsAndroid.PERMISSIONS.READ_PHONE_NUMBERS,
          PermissionsAndroid.PERMISSIONS.CALL_PHONE,
          PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
        ];

        // Android 13+ requires POST_NOTIFICATIONS
        if (Platform.Version >= 33) {
          permissions.push("android.permission.POST_NOTIFICATIONS" as any);
        }

        const granted = await PermissionsAndroid.requestMultiple(permissions);
        console.log("[CallKeep] Permissions granted:", granted);
      } catch (err) {
        console.warn("[CallKeep] Permission request failed:", err);
      }
    }

    const callKeepOptions = {
      ios: {
        appName: "Srot",
      },
      android: {
        alertTitle: "Permissions required",
        alertDescription:
          "This application needs to access your phone accounts",
        cancelButton: "Cancel",
        okButton: "ok",
        imageName: "phone_account_icon",
        additionalPermissions: [],
        selfManaged: true,
        // Allows the app to show its own answer/reject UI or floating window
        foregroundService: {
          channelId: "com.p2p.decentralized.call",
          channelName: "Incoming Calls",
          notificationTitle: "Incoming Call",
          notificationIcon: "ic_launcher",
        },
      },
    };

    try {
      const accepted = await RNCallKeep.setup(callKeepOptions);
      console.log("[CallKeep] Setup finished, accepted:", accepted);

      if (Platform.OS === "android") {
        RNCallKeep.setAvailable(true);
      }

      this.setupListeners();
      this.isInitialized = true;
    } catch (err) {
      console.error("[CallKeep] Setup failed:", err);
    }
  }

  private setupListeners() {
    RNCallKeep.addEventListener("answerCall", ({ callUUID }) => {
      console.log("[CallKeep] User answered call:", callUUID);
      const metadata = this.pendingCallMetadata[callUUID];

      // Navigate to the call screen or tell the app to answer
      UIEvents.emit("CALLKEEP_ANSWER", { callUUID, ...metadata });
      RNCallKeep.backToForeground();
    });

    RNCallKeep.addEventListener("endCall", ({ callUUID }) => {
      console.log("[CallKeep] User ended call:", callUUID);
      UIEvents.emit("CALLKEEP_END", { callUUID });
      delete this.pendingCallMetadata[callUUID];
    });

    RNCallKeep.addEventListener("didActivateAudioSession", () => {
      console.log("[CallKeep] Audio session activated");
    });
  }

  displayIncomingCall(
    uuid: string,
    handle: string,
    localizedCallerName: string,
    metadata?: any,
  ) {
    console.log("[CallKeep] Displaying incoming call:", localizedCallerName);
    if (metadata) {
      this.pendingCallMetadata[uuid] = metadata;
    }

    RNCallKeep.displayIncomingCall(
      uuid,
      handle,
      localizedCallerName,
      "number",
      false,
    );
  }

  getPendingCallMetadata(uuid: string) {
    return this.pendingCallMetadata[uuid];
  }

  endCall(uuid: string) {
    RNCallKeep.endCall(uuid);
    delete this.pendingCallMetadata[uuid];
  }

  startCall(uuid: string, handle: string, contactName: string) {
    RNCallKeep.startCall(uuid, handle, contactName);
  }
}

export const CallKeepService = new CallKeepServiceClass();
