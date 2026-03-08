import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { DatabaseProvider } from "@/contexts/DatabaseContext";
import { UIProvider } from "@/contexts/UIContext";
import { WebRTCProvider } from "@/contexts/WebRTCContext";
import { CallKeepService } from "@/services/CallKeepService";
import { CallService } from "@/services/CallService";
import { PushNotificationService } from "@/services/PushNotificationService";
import * as Linking from 'expo-linking';
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { UIEvents, UI_EVENT_TYPES } from '@/utils/UIEvents';

/**
 * SystemCallHandler
 * Listens for system-wide 'tel:' intents and opens the dialer modal.
 */
function SystemCallHandler() {
  useEffect(() => {
    const handleUrl = (url: string) => {
      if (url.startsWith('tel:')) {
        const number = url.replace('tel:', '').split('?')[0];
        console.log("[SystemCall] Opening dialer for:", number);
        UIEvents.emit(UI_EVENT_TYPES.OPEN_DIALER, number);
      }
    };

    Linking.getInitialURL().then(url => {
      if (url) handleUrl(url);
    });

    const sub = Linking.addEventListener('url', (event) => {
      handleUrl(event.url);
    });

    return () => sub.remove();
  }, []);

  return null;
}

/**
 * SignalingManager
 * Handles the lifetime of signaling servers and clients.
 * It's inside AuthProvider so it can access the logged-in userId.
 */
function SignalingManager() {
  const { userId, name } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // 0. Setup CallKeep (System level calling UI)
    CallKeepService.setup();

    // Listener for when a call is answered from the native UI (even in background)
    const onAnswer = (data: any) => {
      console.log("[SignalingManager] 📞 Call answered from CallKeep:", data);

      router.push({
        pathname: "/call",
        params: {
          type: "incoming",
          peerId: data.fromId || data.handle,
          peerName: data.from || data.localizedCallerName || "Incoming Call",
          callId: data.callId || data.callUUID,
          offer: data.sdp, // This comes from the FCM metadata we stored
          callType: data.callType || "video",
          autoAnswer: "true",
        },
      });
    };

    UIEvents.on("CALLKEEP_ANSWER", onAnswer);

    // 1. Initialize CallService with router and identity
    if (userId) {
      CallService.init((path) => router.push(path), userId, name || undefined);

      PushNotificationService.registerForPushNotificationsAsync(userId);
      PushNotificationService.setupBackgroundHandlers();
    }
    return () => {
      UIEvents.off("CALLKEEP_ANSWER", onAnswer);
    };
  }, [userId]);

  return null;
}


export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <DatabaseProvider>
          <AuthProvider>
            <UIProvider>
              <WebRTCProvider>
                <SignalingManager />
                <SystemCallHandler />
                <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
                  <StatusBar style="dark" />
                  <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
                    <Stack.Screen name="index" />
                    <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
                    <Stack.Screen name="(tabs)" />
                    <Stack.Screen name="call" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
                    <Stack.Screen name="conversation/[id]" options={{ animation: 'slide_from_right' }} />
                  </Stack>
                </View>
              </WebRTCProvider>
            </UIProvider>
          </AuthProvider>
        </DatabaseProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
