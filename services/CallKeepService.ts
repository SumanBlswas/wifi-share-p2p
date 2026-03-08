import { UIEvents } from "@/utils/UIEvents";
import { Platform } from "react-native";
import RNCallKeep from "react-native-callkeep";

/**
 * CallKeepService
 * Manages the native system-level calling UI (CallKit for iOS, ConnectionService for Android).
 * This allows calls to show on the lock screen and work when the app is in the background.
 */
class CallKeepServiceClass {
  private isInitialized = false;

  setup() {
    if (this.isInitialized) return;

    const options = {
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
        // This is critical for Android system integration
        selfManaged: true,
      },
    };

    try {
      RNCallKeep.setup(options).then((accepted) => {
        console.log("[CallKeep] Setup finished, accepted:", accepted);

        if (Platform.OS === "android") {
          RNCallKeep.setAvailable(true);
        }
      });

      this.setupListeners();
      this.isInitialized = true;
    } catch (err) {
      console.error("[CallKeep] Setup failed:", err);
    }
  }

  private setupListeners() {
    RNCallKeep.addEventListener("answerCall", ({ callUUID }) => {
      console.log("[CallKeep] User answered call:", callUUID);
      // Navigate to the call screen or tell the app to answer
      UIEvents.emit("CALLKEEP_ANSWER", { callUUID });
      RNCallKeep.backToForeground();
    });

    RNCallKeep.addEventListener("endCall", ({ callUUID }) => {
      console.log("[CallKeep] User ended call:", callUUID);
      UIEvents.emit("CALLKEEP_END", { callUUID });
    });

    RNCallKeep.addEventListener("didActivateAudioSession", () => {
      console.log("[CallKeep] Audio session activated");
    });
  }

  displayIncomingCall(
    uuid: string,
    handle: string,
    localizedCallerName: string,
  ) {
    console.log("[CallKeep] Displaying incoming call:", localizedCallerName);
    RNCallKeep.displayIncomingCall(
      uuid,
      handle,
      localizedCallerName,
      "number",
      false,
    );
  }

  endCall(uuid: string) {
    RNCallKeep.endCall(uuid);
  }

  startCall(uuid: string, handle: string, contactName: string) {
    RNCallKeep.startCall(uuid, handle, contactName);
  }
}

export const CallKeepService = new CallKeepServiceClass();
