/**
 * SigClient.ts — TCP signaling client
 *
 * Sends a JSON call signal to a peer's signaling server (port 55000).
 * Fire-and-forget with a 5s timeout — returns true if delivered, false if unreachable.
 */

import TcpSocket from "react-native-tcp-socket";
import { CALL_PORT, CallSignal } from "./SigServer";

const TIMEOUT_MS = 5000;

export function sendSignal(
  peerIp: string,
  signal: CallSignal,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;

    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        client.destroy();
      } catch (_) {}
      resolve(ok);
    };

    const timer = setTimeout(() => {
      console.warn("[SigClient] Timeout reaching", peerIp);
      settle(false);
    }, TIMEOUT_MS);

    let client: any;
    try {
      client = TcpSocket.createConnection(
        { host: peerIp, port: CALL_PORT },
        () => {
          const payload = JSON.stringify(signal) + "\n";
          client.write(payload, "utf8", () => settle(true));
        },
      );
      client.on("error", (err: any) => {
        console.warn("[SigClient] Error →", peerIp, err?.message);
        settle(false);
      });
    } catch (e) {
      console.warn("[SigClient] createConnection threw:", e);
      settle(false);
    }
  });
}
