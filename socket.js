// socket.js
const { Server } = require("socket.io");
const admin = require("./config/firebase"); // For Firebase Admin SDK
const User = require("./models/User"); // For User model lookup
const logger = require("./utils/logger"); // For logging

let io;

// Socket.IO Authentication Middleware
const socketAuthMiddleware = async (socket, next) => {
  const operation = "socketAuthMiddleware";
  // Extract token from handshake data (sent by client)
  const token = socket.handshake.auth?.token;

  if (!token) {
    logger.warn({
      operation,
      socketId: socket.id,
      message: "Socket connection attempt without token.",
    });
    return next(new Error("Authentication error: No token provided."));
  }

  try {
    logger.info({
      operation,
      socketId: socket.id,
      message: "Attempting to verify socket token...",
    });
    // Verify the Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(token);
    logger.info({
      operation,
      socketId: socket.id,
      message: "Socket token verified successfully",
      decodedUid: decodedToken.uid,
    });

    // --- Find or Link User in DB (Similar logic to HTTP auth middleware) ---
    let user = await User.findOne({ firebaseUID: decodedToken.uid }).select(
      "_id email"
    ); // Select necessary fields

    if (!user && decodedToken.email) {
      // Try finding by email if not found by UID
      logger.info({
        operation,
        socketId: socket.id,
        message: `Socket user not found by UID ${decodedToken.uid}, trying email ${decodedToken.email}`,
      });
      user = await User.findOne({ email: decodedToken.email }).select(
        "_id email firebaseUID"
      );
      if (user) {
        // User found by email, link if UID is missing or handle conflict
        if (!user.firebaseUID) {
          user.firebaseUID = decodedToken.uid;
          await user.save();
          logger.info({
            operation,
            socketId: socket.id,
            message: `Linked Firebase UID ${decodedToken.uid} to existing user ${user._id} via socket auth.`,
          });
        } else if (user.firebaseUID !== decodedToken.uid) {
          logger.warn({
            operation,
            socketId: socket.id,
            message: `Socket Auth: User found by email ${user.email} but already has different Firebase UID (${user.firebaseUID}). Token UID: ${decodedToken.uid}.`,
            userId: user._id,
          });
          // Decide on conflict policy: For now, deny socket connection in case of conflict
          return next(new Error("Authentication error: Account UID conflict."));
        }
      }
    }

    // If user still not found (and not created by HTTP auth yet), deny connection
    // We generally expect users to be created via HTTP signup/login first
    if (!user) {
      logger.warn({
        operation,
        socketId: socket.id,
        message: `Socket Auth: No corresponding user found in DB for verified token UID ${decodedToken.uid}. Rejecting connection.`,
      });
      return next(new Error("Authentication error: User not found."));
    }

    // --- Attach user ID to socket for later use ---
    socket.userId = user._id.toString(); // Store the MongoDB user ID as string
    logger.info({
      operation,
      socketId: socket.id,
      message: `Socket authenticated for user ${socket.userId}`,
    });

    // Authentication successful
    next();
  } catch (error) {
    logger.error({
      operation,
      socketId: socket.id,
      message: `Socket authentication error: ${error.message}`,
      errorCode: error.code,
      // error: error // Avoid logging full error object unless necessary for debugging
    });
    let authError = new Error(
      "Authentication error: Invalid or expired token."
    );
    if (error.code === "auth/id-token-expired") {
      authError = new Error("Authentication error: Token has expired.");
    }
    next(authError); // Pass error to deny connection
  }
};

const setupSocket = (server) => {
  io = new Server(server, {
    cors: {
      // Ensure this matches your frontend URL(s) and includes credentials if needed
      origin: process.env.ALLOWED_ORIGINS?.split(",") || [
        "http://localhost:3000",
        "https://yourfrontend.com",
      ], // Example
      methods: ["GET", "POST"],
      credentials: true, // May be needed depending on frontend setup
    },
  });

  // --- Apply Authentication Middleware to ALL incoming connections ---
  io.use(socketAuthMiddleware);

  io.on("connection", (socket) => {
    // At this point, the socket connection is already authenticated by the middleware
    // The verified MongoDB user ID is available as socket.userId

    logger.info(
      `🟢 Authenticated client connected: ${socket.id}, User ID: ${socket.userId}`
    );

    // --- Automatically join the user to their private room ---
    if (socket.userId) {
      socket.join(socket.userId); // Join room named after their MongoDB ID
      logger.info(
        `User ${socket.userId} automatically joined their private room ${socket.userId}`
      );

      // Optional: Send a confirmation back to the client
      socket.emit("authenticated", {
        userId: socket.userId,
        message: "Successfully authenticated and joined room.",
      });
    } else {
      // Should not happen if middleware is correct, but log as a safeguard
      logger.error(
        `Socket connected (${socket.id}) but missing verified userId after auth middleware. Disconnecting.`
      );
      socket.disconnect(true); // Force disconnect if userId is missing post-auth
      return;
    }

    // --- REMOVED the insecure 'join' listener ---
    // socket.on("join", (userId) => { ... }); // Old insecure listener is GONE

    // Handle disconnect
    socket.on("disconnect", (reason) => {
      logger.info(
        `🔴 Client disconnected: ${socket.id}, User ID: ${socket.userId}, Reason: ${reason}`
      );
      // No need to manually leave rooms, Socket.IO handles this on disconnect
    });

    // Handle potential errors on the socket after connection
    socket.on("error", (err) => {
      logger.error({
        message: `Socket error on connection ${socket.id}`,
        userId: socket.userId,
        error: err.message,
      });
    });
  });

  logger.info(
    "✅ Socket.IO Server Initialized with Authentication Middleware."
  );
};

// 🔹 Emit events from anywhere in the app to a specific user's room
const sendNotification = (userId, type, message) => {
  const operation = "sendNotification";
  // Ensure userId is a string for room targeting
  const targetUserId = userId?.toString();

  if (io && targetUserId) {
    const payload = {
      type,
      message,
      timestamp: new Date(),
    };
    io.to(targetUserId).emit("notification", payload);
    logger.info({
      operation,
      message: `Sent notification to user ${targetUserId}`,
      type,
      payload,
    });
  } else if (!io) {
    logger.warn({
      operation,
      message:
        "Attempted to send notification, but Socket.IO server (io) is not initialized.",
      targetUserId,
      type,
    });
  } else {
    logger.warn({
      operation,
      message: "Attempted to send notification with invalid targetUserId.",
      targetUserId,
      type,
    });
  }
};

module.exports = { setupSocket, sendNotification };
