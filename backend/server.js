const express = require("express");
const fs = require("fs");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { GoogleAuth } = require("google-auth-library");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// userId -> socketId (current connection)
const users = new Map();
// userId -> pushToken (persistent for background calls)
const tokens = new Map();

function inferTokenType(token) {
  if (
    token.startsWith("ExponentPushToken") ||
    token.startsWith("ExpoPushToken")
  ) {
    return "expo";
  }
  return "fcm";
}

function loadServiceAccount() {
  const json = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (json) {
    try {
      return JSON.parse(json);
    } catch (e) {
      console.error("[Push] Failed to parse FCM_SERVICE_ACCOUNT_JSON");
    }
  }
  const path = process.env.FCM_SERVICE_ACCOUNT_PATH;
  if (path && fs.existsSync(path)) {
    try {
      const content = fs.readFileSync(path, "utf8");
      return JSON.parse(content);
    } catch (e) {
      console.error("[Push] Failed to read FCM service account file");
    }
  }
  return null;
}

const serviceAccount = loadServiceAccount();
const projectId =
  process.env.FCM_PROJECT_ID || serviceAccount?.project_id || null;
const auth = serviceAccount
  ? new GoogleAuth({
      credentials: serviceAccount,
      scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
    })
  : null;

async function getFcmAccessToken() {
  if (!auth) return null;
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (typeof token === "string") return token;
  return token?.token || null;
}

async function sendExpoPushNotification(expoPushToken, payload) {
  const fromName = payload.fromName || payload.from || "Unknown";
  const message = {
    to: expoPushToken,
    sound: "default",
    title: `Incoming call from ${fromName}`,
    body: "Tap to answer",
    data: { ...payload, type: "call-offer", fromName },
    priority: "high",
    channelId: "default",
  };

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });
    console.log(
      `[Push] Sent to ${payload.targetId}, Status: ${response.status}`,
    );
  } catch (err) {
    console.error(`[Push] Failed:`, err);
  }
}

async function sendFcmPushNotification(fcmToken, payload) {
  if (!projectId || !auth) {
    console.log("[Push] Missing FCM service account or projectId.");
    return;
  }

  const fromName = payload.fromName || payload.from || "Unknown";
  const dataPayload = {
    type: "call-offer",
    callId: payload.callId ? String(payload.callId) : undefined,
    fromId: payload.fromId ? String(payload.fromId) : undefined,
    fromName: String(fromName),
    callType: payload.callType ? String(payload.callType) : undefined,
    sdp: payload.sdp ? String(payload.sdp) : undefined,
    handle: payload.handle ? String(payload.handle) : undefined,
  };
  Object.keys(dataPayload).forEach((key) => {
    if (dataPayload[key] === undefined) delete dataPayload[key];
  });
  const message = {
    message: {
      token: fcmToken,
      notification: {
        title: `Incoming call from ${fromName}`,
        body: "Tap to answer",
      },
      data: dataPayload,
      android: {
        priority: "HIGH",
        notification: {
          channel_id: "incoming-call",
          sound: "default",
        },
      },
    },
  };

  try {
    const accessToken = await getFcmAccessToken();
    if (!accessToken) {
      console.log("[Push] Failed to acquire FCM access token.");
      return;
    }
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      },
    );
    const responseText = await response.text();
    console.log(
      `[Push] FCM v1 sent to ${payload.targetId}, Status: ${response.status}`,
    );
    if (!response.ok) {
      console.log(`[Push] FCM v1 error body: ${responseText}`);
    }
  } catch (err) {
    console.error(`[Push] FCM v1 Failed:`, err);
  }
}

io.on("connection", (socket) => {
  console.log("⚡ A device connected:", socket.id);

  socket.on("register", (data) => {
    if (data.userId) {
      users.set(data.userId, socket.id);
      console.log(`👤 User registered: ${data.userId} -> Socket: ${socket.id}`);
      io.emit("peer_online", data.userId);
    }
  });

  socket.on("register_push", (data) => {
    if (data.userId && data.token) {
      const type = data.type || inferTokenType(data.token);
      tokens.set(data.userId, { token: data.token, type });
      console.log(`📲 Push token stored for: ${data.userId} (${type})`);
    }
  });

  socket.on("signal", (payload) => {
    const targetSocketId = users.get(payload.targetId);

    if (targetSocketId) {
      io.to(targetSocketId).emit("signal", payload);
      console.log(
        `✉️ Signal [${payload.type}] sent via Socket -> ${payload.targetId}`,
      );
    } else if (payload.type === "call-offer") {
      // User is offline, try pushing
      const tokenInfo = tokens.get(payload.targetId);
      if (tokenInfo) {
        console.log(`💤 ${payload.targetId} is offline. Sending Push...`);
        if (tokenInfo.type === "expo") {
          sendExpoPushNotification(tokenInfo.token, payload);
        } else {
          sendFcmPushNotification(tokenInfo.token, payload);
        }
      } else {
        console.log(
          `❌ Signal failed: ${payload.targetId} is offline and has no push token`,
        );
      }
    }
  });

  socket.on("disconnect", () => {
    let disconnectedUserId = null;
    for (const [userId, sId] of users.entries()) {
      if (sId === socket.id) {
        disconnectedUserId = userId;
        users.delete(userId);
        break;
      }
    }

    if (disconnectedUserId) {
      io.emit("peer_offline", disconnectedUserId);
    }
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Srot Global Signaling Server running on port ${PORT}`);
});
