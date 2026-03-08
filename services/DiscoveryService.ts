import { EventEmitter } from "@/utils/EventEmitter";
import DeviceInfo from "react-native-device-info";
import TcpSocket from "react-native-tcp-socket";
import { CALL_PORT } from "./SigServer";

type DiscoveredPeer = {
  id: string;
  name: string;
  phone: string;
  ip: string;
  lastSeen: number;
};

class DiscoveryServiceClass extends EventEmitter {
  private discoveredPeers: Map<string, DiscoveredPeer> = new Map();
  private isScanning = false;
  private localIp: string | null = null;

  async startDiscovery(isManual = false) {
    if (this.isScanning) return;
    if (isManual) {
      this.discoveredPeers.clear();
    }
    this.isScanning = true;
    console.log("[Discovery] Starting local network scan...");

    try {
      this.localIp = await DeviceInfo.getIpAddress();
      console.log(`[Discovery] My Local IP is: ${this.localIp}`);

      if (!this.localIp || this.localIp === "0.0.0.0") {
        console.warn("[Discovery] Could not determine local IP");
        this.isScanning = false;
        return;
      }

      const subnet = this.localIp.substring(0, this.localIp.lastIndexOf("."));
      console.log(
        `[Discovery] Scanning Subnet: ${subnet}.1 to ${subnet}.254 on port ${CALL_PORT}`,
      );
      this.scanSubnet(subnet);
    } catch (err) {
      console.error("[Discovery] Error starting scan:", err);
      this.isScanning = false;
    }
  }

  private async scanSubnet(subnet: string) {
    const BATCH_SIZE = 32;
    const ips = [];
    for (let i = 1; i < 255; i++) {
      ips.push(`${subnet}.${i}`);
    }

    for (let i = 0; i < ips.length; i += BATCH_SIZE) {
      const batch = ips.slice(i, i + BATCH_SIZE);
      const promises = batch.map((ip) => this.probePeer(ip));
      await Promise.allSettled(promises);
    }

    this.isScanning = false;
    console.log("[Discovery] Scan complete. Found:", this.discoveredPeers.size);
  }

  private probePeer(ip: string): Promise<void> {
    if (ip === this.localIp || ip === "127.0.0.1" || ip === "localhost")
      return Promise.resolve(); // Don't probe self

    return new Promise((resolve) => {
      let resolved = false;
      const socket = TcpSocket.createConnection(
        { port: CALL_PORT, host: ip, connectTimeout: 2000 },
        () => {
          // Send identity request
          if (socket && !socket.destroyed) {
            socket.write(
              JSON.stringify({
                type: "identity-request",
                callId: "identity",
                from: "discovery",
                fromId: "discovery",
              }) + "\n",
            );
          }
        },
      );

      socket.setTimeout(2000, () => {
        if (!resolved) {
          resolved = true;
          if (socket && !socket.destroyed) socket.destroy();
          resolve();
        }
      });

      socket.on("data", (data: any) => {
        try {
          const signal = JSON.parse(data.toString().split("\n")[0]);
          if (signal.type === "identity-response") {
            this.addPeer(ip, signal.name, signal.phone);
          }
        } catch (e) {
          // Fallback if identity fails - we found an app instance but couldn't get name
          this.addPeer(ip);
        } finally {
          if (!resolved) {
            resolved = true;
            if (socket && !socket.destroyed) socket.destroy();
            resolve();
          }
        }
      });

      socket.on("error", (err) => {
        if (ip === "192.168.1.5" || ip === "192.168.1.8") {
          console.log(`[Discovery] Target ${ip} probe failed explicitly:`, err);
        }
        if (!resolved) {
          resolved = true;
          if (socket && !socket.destroyed) socket.destroy();
          resolve();
        }
      });

      socket.on("close", () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      });
    });
  }

  private addPeer(ip: string, name?: string, phone?: string) {
    const id = phone || `local-${ip}`;
    const peer: DiscoveredPeer = {
      id,
      name: name || `Peer at ${ip}`,
      phone: phone || "",
      ip,
      lastSeen: Date.now(),
    };
    this.discoveredPeers.set(id, peer);
    this.emit("peer_discovered", peer);
  }

  getPeers() {
    return Array.from(this.discoveredPeers.values());
  }
}

export const DiscoveryService = new DiscoveryServiceClass();
