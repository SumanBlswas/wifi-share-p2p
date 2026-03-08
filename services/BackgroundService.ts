import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from "expo-task-manager";

const BACKGROUND_FETCH_TASK = "background-p2p-sync";

// Define the task to ping the Decentralized Signaling node while app is closed
TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
  try {
    const isOnline = true; // Check real network status

    if (isOnline) {
      // Connect to the known P2P Bootstrap signaling node to check for incoming calls/messages
      // If a message/call is detected:
      // - Trigger CallService (RNCallKeep.displayIncomingCall)
      // - Or insert message into local SQLite database
      console.log("Background P2P Sync check executed.");

      // We must return a result to the OS indicating success
      return BackgroundFetch.BackgroundFetchResult.NewData;
    }

    return BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (err) {
    console.error(err);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// Configure the interval for Android 16
export async function registerBackgroundFetchAsync() {
  return BackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
    minimumInterval: 15 * 60, // 15 minutes
    stopOnTerminate: false, // Continue running after app is swiped away
    startOnBoot: true, // Start automatically when the phone turns on
  });
}

export async function unregisterBackgroundFetchAsync() {
  return BackgroundFetch.unregisterTaskAsync(BACKGROUND_FETCH_TASK);
}
