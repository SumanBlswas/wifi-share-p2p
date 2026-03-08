import { EventEmitter } from "@/utils/EventEmitter";
import { io, Socket } from "socket.io-client";
import { CallSignal } from "./SigServer";

const GLOBAL_SIGNAL_URL = "https://call-me-now.onrender.com";

class GlobalSigClientClass extends EventEmitter {
  private socket: Socket | null = null;
  private pushToken: string | null = null;
  private pushTokenType: "expo" | "fcm" | null = null;
  private userId: string | null = null;
  private connected = false;
  private knownPeers: Map<string, { name: string; phone: string }> = new Map();

  init(userId: string) {
    if (this.socket?.connected && this.userId === userId) return;

    this.userId = userId;
    if (this.socket) {
      this.socket.disconnect();
    }

    console.log("[GlobalSig] Connecting to:", GLOBAL_SIGNAL_URL);
    this.socket = io(GLOBAL_SIGNAL_URL, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 10,
    });

    this.socket.on("connect", () => {
      this.connected = true;
      console.log(`[GlobalSig] ✅ Connected to Render backend as ${userId}`);
      // Register with the canonical userId
      this.socket?.emit("register", { userId });

      // Auto-register push token if we have one
      if (this.pushToken) {
        this.socket?.emit("register_push", {
          userId,
          token: this.pushToken,
          type: this.pushTokenType || undefined,
        });
      }

      this.emit("online", true);
    });

    this.socket.on("reconnect", () => {
      console.log("[GlobalSig] ♻️ Reconnected, re-registering...");
      if (this.userId) this.socket?.emit("register", { userId: this.userId });
    });

    this.socket.on("disconnect", () => {
      this.connected = false;
      console.warn("[GlobalSig] ❌ Disconnected");
      this.emit("online", false);
    });

    this.socket.on("signal", (payload: any) => {
      console.log(
        `[GlobalSig] 📥 Incoming ${payload.type} from ${payload.fromId || payload.from} (callId: ${payload.callId})`,
      );

      // PASSIVE DISCOVERY
      const fromId = payload.fromId || payload.from;
      if (fromId && fromId !== this.userId && !this.knownPeers.has(fromId)) {
        console.log("[GlobalSig] 🕵️ Passive discovery of peer:", fromId);

        // Add to knownPeers immediately as "Unknown" to prevent duplicate requests
        this.knownPeers.set(fromId, { name: "Unknown Peer", phone: fromId });

        this.emit("peer_online", fromId);
        this.sendSignal(fromId, {
          type: "identity-request",
          callId: "identity",
          from: "discovery",
          fromId: this.userId || "anonymous",
        });
      }

      if (payload.type === "identity-response") {
        if (payload.fromId === this.userId) return; // Never track self
        this.knownPeers.set(payload.fromId, {
          name: payload.name,
          phone: payload.phone,
        });
        this.emit("peer_identified", {
          id: payload.fromId,
          name: payload.name,
          phone: payload.phone,
          type: "global",
        });
      }
      this.emit("signal", payload);
    });

    this.socket.on("peer_online", (peerId: string) => {
      if (peerId === this.userId || this.knownPeers.has(peerId)) return;

      console.log("[GlobalSig] 🌐 Peer online event:", peerId);
      this.knownPeers.set(peerId, { name: "Unknown Peer", phone: peerId });

      this.emit("peer_online", peerId);
      // Auto-request identity
      this.sendSignal(peerId, {
        type: "identity-request",
        callId: "identity",
        from: "discovery",
        fromId: this.userId || "anonymous",
      });
    });

    this.socket.on("peer_offline", (peerId: string) => {
      this.knownPeers.delete(peerId);
      this.emit("peer_offline", peerId);
    });
  }

  refreshPeers() {
    console.log("[GlobalSig] Refreshing known peers list...");
    this.knownPeers.forEach(
      (data: { name: string; phone: string }, id: string) => {
        this.emit("peer_identified", {
          id,
          name: data.name,
          phone: data.phone,
          type: "global",
        });
      },
    );
  }

  sendSignal(targetId: string, signal: CallSignal) {
    if (!this.socket?.connected) {
      console.warn(
        `[GlobalSig] ❌ Cannot send ${signal.type}: Socket NOT connected`,
      );
      return false;
    }

    console.log(`[GlobalSig] 📤 Outgoing ${signal.type} to ${targetId}`);
    this.socket.emit("signal", {
      ...signal,
      targetId,
    });
    return true;
  }

  registerPushToken(userId: string, token: string, type?: "expo" | "fcm") {
    this.pushToken = token;
    this.pushTokenType = type || null;
    if (this.socket?.connected) {
      this.socket.emit("register_push", { userId, token, type });
      console.log("[GlobalSig] 📲 Push token registered with backend");
    } else {
      // If not connected yet, it will register when connected
      console.log(
        "[GlobalSig] ⏳ Waiting for connection to register push token",
      );
    }
  }

  isOnline() {
    return this.connected;
  }

  getSocketId() {
    return this.socket?.id;
  }
}

export const GlobalSigClient = new GlobalSigClientClass();
