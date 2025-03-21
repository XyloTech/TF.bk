const { Server } = require("socket.io");

let io;

const setupSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.ALLOWED_ORIGINS?.split(",") || [
        "https://yourfrontend.com",
      ],
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    console.log(`🟢 New client connected: ${socket.id}`);

    // Handle joining private rooms for authenticated users
    socket.on("join", (userId) => {
      socket.join(userId);
      console.log(`User ${userId} joined their private room`);
    });

    // Handle disconnect
    socket.on("disconnect", () => {
      console.log(`🔴 Client disconnected: ${socket.id}`);
    });
  });
};

// 🔹 Emit events from anywhere in the app
const sendNotification = (userId, type, message) => {
  if (io) {
    io.to(userId).emit("notification", {
      type,
      message,
      timestamp: new Date(),
    });
  }
};

module.exports = { setupSocket, sendNotification };
