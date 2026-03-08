const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");

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
  const serverKey = process.env.FCM_SERVER_KEY;
  if (!serverKey) {
    console.log("[Push] Missing FCM_SERVER_KEY. Cannot send FCM push.");
    return;
  }

  const fromName = payload.fromName || payload.from || "Unknown";
  const message = {
    to: fcmToken,
    priority: "high",
    data: { ...payload, type: "call-offer", fromName },
    android: {
      priority: "high",
    },
  };

  try {
    const response = await fetch("https://fcm.googleapis.com/fcm/send", {
      method: "POST",
      headers: {
        Authorization: `key=${serverKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });
    console.log(
      `[Push] FCM sent to ${payload.targetId}, Status: ${response.status}`,
    );
  } catch (err) {
    console.error(`[Push] FCM Failed:`, err);
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
