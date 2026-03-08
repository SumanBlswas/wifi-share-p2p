/**
 * CallService.ts — Hybrid Signaling (Global & Local)
 * Automatically routes signals via Render Global Backend (Socket.io) or P2P Local (TCP).
 */

import { EventEmitter } from "@/utils/EventEmitter";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { RTCPeerConnection } from "react-native-webrtc";
import { CallKeepService } from "./CallKeepService";
import { GlobalSigClient } from "./GlobalSigClient";
import { sendSignal as sendTcpSignal } from "./SigClient";
import { CallSignal, SigServer } from "./SigServer";

export const CallEvents = new EventEmitter();

class CallServiceClass {
  private peers: { [peerId: string]: RTCPeerConnection } = {};
  private onIncomingCall: ((signal: CallSignal) => void) | null = null;
  private onCallEnded: ((callId?: string) => void) | null = null;
  private onCallRinging: ((callId?: string) => void) | null = null;
  private routerPush: ((path: any) => void) | null = null;
  private isInitialized = false;
  private identity: { name: string; phone: string } | null = null;
  private activeCallId: string | null = null;
  private isCallActive = false;
  private recentOutgoingCalls: Map<string, number> = new Map();

  async setCallActive(active: boolean) {
    this.isCallActive = active;
    if (!active) this.activeCallId = null;
    try {
      await AsyncStorage.setItem(
        "@is_calling_active",
        active ? "true" : "false",
      );
    } catch (e) {}
  }

  async setActiveCall(callId: string | null) {
    this.activeCallId = callId;
    this.isCallActive = !!callId;
    try {
      await AsyncStorage.setItem(
        "@is_calling_active",
        !!callId ? "true" : "false",
      );
    } catch (e) {}
  }

  // Record that we just sent a call to a specific peer to prevent loops
  recordOutgoingCall(peerId: string) {
    this.recentOutgoingCalls.set(peerId, Date.now());
  }

  init(routerPush: (path: any) => void, userId?: string, userName?: string) {
    this.routerPush = routerPush;
    if (userId && userName) {
      this.identity = { name: userName, phone: userId };
    }

    if (!this.isInitialized) {
      // 1. Listen for local direct TCP signals
      SigServer.on("signal", (signal: CallSignal) => this.handleSignal(signal));

      // 2. Listen for global Render backend signals
      GlobalSigClient.on("signal", (signal: CallSignal) =>
        this.handleSignal(signal),
      );

      this.isInitialized = true;
    }

    // 3. (Re)Initialize Global Backend connection if userId provided
    if (userId) {
      GlobalSigClient.init(userId);
    }

    console.log("[CallService] ✅ Hybrid Signaling Initialized (TCP + Render)");
  }

  private async handleSignal(signal: CallSignal) {
    // 1. DYNAMIC IDENTITY CHECK: Ensure we know who we are to filter reflected signals
    let myId: string | null = this.identity?.phone || null;
    if (!myId) {
      myId = await AsyncStorage.getItem("@user_id");
    }

    // 2. IGNORE signals from ourself (prevents "calling yourself" loop)
    if (myId && signal.fromId === myId) {
      console.log(
        `[CallService] 🤫 Ignoring reflected ${signal.type} from self`,
      );
      return;
    }

    // 3. BUSY PROTECTION: If we are already in a call, ignore new offers
    if (signal.type === "call-offer" && this.isCallActive) {
      console.log(
        `[CallService] 📵 Busy: Ignoring incoming call-offer from ${signal.from} because a call is already active.`,
      );
      return;
    }

    // 4. CALL GLARE PROTECTION (CRITICAL FIX)
    // If we just sent an offer to this person in the last 10 seconds,
    // ignore any incoming offer from them to prevent the "double ring" loop.
    if (signal.type === "call-offer") {
      const lastSent = this.recentOutgoingCalls.get(signal.fromId!);
      if (lastSent && Date.now() - lastSent < 10000) {
        console.log(
          `[CallService] 🚫 Shielding Srot: Glare detected. Ignoring incoming call from ${signal.from} because we are already calling them.`,
        );
        return;
      }
    }

    console.log(
      "[CallService] 📥 Signal Received via",
      signal.fromIp ? "TCP" : "Global",
      ":",
      signal.type,
    );

    switch (signal.type) {
      case "call-offer":
        // PROTECTION: Do not show Call UI for background data sync/messaging offers
        if (signal.callId && signal.callId.startsWith("data-")) {
          console.log("[CallService] 🤫 Ignoring background data-offer");
          return;
        }

        // PROTECTION: If we are already in this call, it's a renegotiation offer (e.g. video upgrade).
        if (this.activeCallId === signal.callId) {
          console.log(
            "[CallService] ♻️ Ignoring call-offer for active call (renegotiation). Handled by CallScreen.",
          );
          return;
        }

        if (this.onIncomingCall) {
          this.onIncomingCall(signal);
        }

        // TRIGGER SYSTEM LEVEL CALL UI (Floating notification / Lock screen)
        CallKeepService.displayIncomingCall(
          signal.callId!,
          signal.fromId!,
          signal.from!,
          signal,
        );

        // ACKNOWLEDGE: Send 'ringing' back to caller immediately
        if (this.identity) {
          this.sendSignal(signal.fromId!, {
            type: "call-ringing",
            callId: signal.callId!,
            from: this.identity.name,
            fromId: this.identity.phone,
          });
        }

        if (this.routerPush) {
          this.routerPush({
            pathname: "/call",
            params: {
              type: "incoming",
              peerId: signal.fromId,
              peerName: signal.from,
              callId: signal.callId,
              offer: signal.sdp,
              callType: signal.callType || "video",
            },
          });
        }
        break;

      case "call-end":
      case "call-reject":
        if (this.onCallEnded) this.onCallEnded(signal.callId);
        break;

      case "call-ringing":
        if (this.onCallRinging) this.onCallRinging(signal.callId);
        break;

      case "identity-request":
        if (this.identity) {
          this.sendSignal(
            signal.fromId,
            {
              type: "identity-response",
              callId: "identity",
              from: this.identity.name,
              fromId: this.identity.phone,
              name: this.identity.name,
              phone: this.identity.phone,
            },
            signal.fromIp,
          );
        }
        break;

      case "identity-response":
        // Peer identified
        GlobalSigClient.emit("peer_identified", {
          id: signal.fromId,
          name: signal.name,
          phone: signal.phone,
          type: signal.fromIp ? "local" : "global",
          ip: signal.fromIp,
        });
        break;

      case "file-offer":
      case "file-accept":
        CallEvents.emit(signal.type, signal);
        break;

      default:
        break;
    }
  }

  setIncomingCallHandler(handler: (signal: CallSignal) => void) {
    this.onIncomingCall = handler;
  }

  setCallEndedHandler(handler: (callId?: string) => void) {
    this.onCallEnded = handler;
  }

  setCallRingingHandler(handler: (callId?: string) => void) {
    this.onCallRinging = handler;
  }

  async sendSignal(targetId: string, signal: CallSignal, peerIp?: string) {
    console.log(
      `[CallService] 📤 Sending Signal (${signal.type}) to ${targetId}`,
    );
    const sentGlobal = GlobalSigClient.sendSignal(targetId, signal);

    if (sentGlobal) {
      console.log(
        `[CallService] 🌐 Signal [${signal.type}] delivered via Global Backend to ${targetId}`,
      );
      return true;
    }

    // LOCAL TCP FALLBACK IS DISABLED FOR CALLING/MESSAGING per user request.
    // It will only be used if explicitly called for file sharing in the future.
    if (peerIp && signal.callId === "file-share") {
      console.log(
        `[CallService] ⚡ Global failed, trying Local TCP to ${peerIp} (File Share Only)`,
      );
      const sentLocal = await sendTcpSignal(peerIp, signal);
      return sentLocal;
    }

    console.warn(
      `[CallService] ❌ Failed to send signal [${signal.type}] to ${targetId} (Global down and Local IP fallback disabled for this type)`,
    );
    return false;
  }

  async sendOffer(targetId: string, signal: CallSignal, peerIp?: string) {
    return this.sendSignal(targetId, signal, peerIp);
  }

  async sendAnswer(targetId: string, signal: CallSignal, peerIp?: string) {
    return this.sendSignal(targetId, signal, peerIp);
  }

  async sendIceCandidate(
    targetId: string,
    signal: CallSignal,
    peerIp?: string,
  ) {
    return this.sendSignal(targetId, signal, peerIp);
  }

  async endCall(
    targetId: string,
    callId: string,
    fromId: string,
    fromName: string,
    peerIp?: string,
  ) {
    const signal: CallSignal = {
      type: "call-end",
      callId,
      from: fromName,
      fromId,
    };
    return await this.sendSignal(targetId, signal, peerIp);
  }
}

export const CallService = new CallServiceClass();
