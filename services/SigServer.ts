/**
 * SigServer.ts — TCP signaling server (port 55000)
 *
 * Listens for incoming JSON call signals from peers on the local Wi-Fi network.
 * Runs persistently because CallKeep's foreground service keeps the JS process alive.
 *
 * Signal format (newline-delimited JSON):
 *   { type, callId, from, fromId, fromIp?, sdp?, candidate? }
 */

import { EventEmitter } from "@/utils/EventEmitter";
import TcpSocket from "react-native-tcp-socket";

export const CALL_PORT = 55000;

export type SignalType =
  | "call-offer"
  | "call-answer"
  | "call-ringing"
  | "ice-candidate"
  | "call-end"
  | "call-reject"
  | "identity-request"
  | "identity-response"
  | "call-upgrade-request"
  | "call-upgrade-accept"
  | "call-upgrade-reject"
  | "file-offer"
  | "file-accept";

export type CallSignal = {
  type: SignalType;
  callId: string;
  from: string; // caller display name
  fromId: string; // caller userId
  fromIp?: string; // caller's LAN IP (set by server from socket)
  sdp?: string; // SDP offer or answer payload
  candidate?: any; // ICE candidate object
  name?: string; // identity name
  phone?: string; // identity phone
  callType?: "audio" | "video"; // specifies audio-only or video-call

  // File Transfer specific payloads
  fileUrl?: string; // http://192.168.1.5:8080/download
  fileName?: string;
  fileSize?: number;
};

class SigServerClass extends EventEmitter {
  private server: any = null;
  private running = false;
  private activeSockets: Set<any> = new Set();
  private identityGetter: (() => { name: string; phone: string }) | null = null;

  setIdentityGetter(getter: () => { name: string; phone: string }) {
    this.identityGetter = getter;
  }

  start() {
    const attemptStart = async (retriesCount = 3) => {
      try {
        if (this.server) {
          console.log("[SigServer] Stopping existing server before restart...");
          await this.stop(); // Wait for full cleanup
          // Wait 2s for OS to release port
          setTimeout(() => attemptStart(retriesCount), 2000);
          return;
        }

        this.server = TcpSocket.createServer((socket: any) => {
          this.activeSockets.add(socket);
          let buffer = "";

          socket.on("close", () => {
            this.activeSockets.delete(socket);
          });

          socket.on("data", (data: any) => {
            buffer += typeof data === "string" ? data : data.toString("utf8");
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const signal: CallSignal = JSON.parse(line);
                signal.fromIp = signal.fromIp ?? socket.remoteAddress;

                if (signal.type === "identity-request" && this.identityGetter) {
                  const id = this.identityGetter();
                  const response: CallSignal = {
                    type: "identity-response",
                    callId: "identity",
                    from: id.name,
                    fromId: id.phone,
                    name: id.name,
                    phone: id.phone,
                  };
                  if (socket && !socket.destroyed) {
                    socket.write(JSON.stringify(response) + "\n");
                  }
                }

                this.emit("signal", signal);
              } catch (e) {
                console.warn("[SigServer] Malformed signal:", e);
              }
            }
          });
          socket.on("error", (err: any) =>
            console.warn("[SigServer] Socket error:", err?.message || err),
          );
        });

        this.server.on("error", (err: any) => {
          const errMsg = String(err?.message || err || "").toLowerCase();
          const isAddrInUse =
            err?.code === "EADDRINUSE" ||
            errMsg.includes("eaddrinuse") ||
            errMsg.includes("address already in use");

          const isConnectError =
            err?.code === "ECONNREFUSED" ||
            errMsg.includes("econnrefused") ||
            errMsg.includes("failed to connect") ||
            errMsg.includes("connection refused");

          if (isAddrInUse) {
            if (retriesCount > 0) {
              // SILENT WARN instead of ERROR to prevent Expo Red Box
              console.warn(
                `[SigServer] Port :${CALL_PORT} busy (Retrying ${retriesCount} left)...`,
              );
              this.stop();
              setTimeout(() => attemptStart(retriesCount - 1), 3000);
            } else {
              console.error("[SigServer] ❌ Server failed, port fully bound.");
              this.running = false;
              this.stop();
            }
          } else if (isConnectError) {
            // Ignore leaked client errors from the server instance
            console.warn(
              "[SigServer] Ignoring non-fatal connection error:",
              errMsg,
            );
          } else {
            console.error("[SigServer] ❌ Server error:", err?.message || err);
            this.running = false;
            this.stop();
          }
        });

        this.server.listen({ port: CALL_PORT, host: "0.0.0.0" }, () => {
          this.running = true;
          console.log(`[SigServer] ✅ Listening on :${CALL_PORT}`);
        });
      } catch (e: any) {
        console.warn("[SigServer] Start failed (will retry):", e?.message || e);
        this.running = false;
        this.stop();
      }
    };

    attemptStart();
  }

  sendSignal(peerId: string, signal: any) {
    if (!this.running || !this.server) {
      console.warn(`[SigServer] Cannot send signal, server is not running.`);
      return;
    }

    const msgStr = JSON.stringify(signal) + "\n";

    if (signal.type === "file-offer" || signal.type === "file-accept") {
      // Find an active socket to this peer if it exists, otherwise TCP broadcast or look via DiscoveryService.
      // For a dedicated file sharing screen where we ONLY know the peer IP:
      import("react-native-tcp-socket").then(({ default: TcpSocket }) => {
        try {
          const sender = TcpSocket.createConnection(
            {
              port: CALL_PORT,
              host: peerId, // PeerId must be their IP address.
              connectTimeout: 5000,
            },
            () => {
              sender.write(msgStr);
            },
          );
          sender.on("data", () => {
            sender.destroy();
          }); // close after sending
          sender.on("error", () => {
            sender.destroy();
          });
        } catch (e) {
          console.warn(
            `[SigServer] Failed to create TCP socket to peer ${peerId} for file transfer`,
          );
        }
      });
    }
  }

  stop(): Promise<void> {
    this.activeSockets.forEach((s) => {
      try {
        if (!s.destroyed) s.destroy();
      } catch (_) {}
    });
    this.activeSockets.clear();

    if (!this.server) {
      this.running = false;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      try {
        this.server.close(() => {
          this.server = null;
          this.running = false;
          console.log("[SigServer] Stopped");
          resolve();
        });

        // Safety timeout if close takes too long
        setTimeout(() => {
          this.server = null;
          this.running = false;
          resolve();
        }, 1000);
      } catch (_) {
        this.server = null;
        this.running = false;
        resolve();
      }
    });
  }

  isRunning() {
    return this.running;
  }
}

export const SigServer = new SigServerClass();
