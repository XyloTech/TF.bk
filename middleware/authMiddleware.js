const admin = require("firebase-admin");
const User = require("../models/User");
const logger = require("../utils/logger");
const jwt = require('jsonwebtoken');

// Initialize Firebase Admin SDK if not already initialized
// This check prevents re-initialization errors in development environments
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

const authenticateUser = async (req, res, next) => {
  const operation = "authenticateUser";
  try {
    const authHeader = req.headers.authorization;
    logger.info({ operation, message: `Auth Header: ${authHeader}` });
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;
    logger.info({ operation, message: `Extracted Token: ${token ? token.substring(0, 20) + '...' : 'No token'}` });

    if (!token) {
      logger.warn({ operation, message: "No token provided" });
      return res
        .status(401)
        .json({ message: "Unauthorized: No token provided" });
    }

    let decodedToken;
    let user;

    try {
      // Attempt to verify as backend-generated JWT first
      decodedToken = jwt.verify(token, process.env.JWT_SECRET);
      logger.info({ operation, message: "Backend JWT verified successfully" });
      req.user = decodedToken; // Attach decoded JWT payload

      user = await User.findById(decodedToken.userId);
      if (!user) {
        logger.warn({ operation, message: `User not found for userId: ${decodedToken.userId}` });
        return res.status(404).json({ message: "User not found." });
      }
      req.userDB = user; // Attach the MongoDB user document

    } catch (jwtError) {
      logger.warn({ operation, message: `JWT verification failed: ${jwtError.message}. Attempting Firebase verification.` });
      // Fallback to Firebase ID token verification
      decodedToken = await admin.auth().verifyIdToken(token);
      logger.info({
        operation,
        message: "Firebase ID Token verified successfully",
        decodedUid: decodedToken.uid,
      });
      req.user = decodedToken; // Attach Firebase user info

      // --- User lookup/creation logic for Firebase authenticated users ---
      logger.info({
        operation,
        message: `Searching for user by firebaseUID: ${decodedToken.uid}`,
      });
      user = await User.findOne({ firebaseUID: decodedToken.uid });

      if (!user) {
        logger.info({
          operation,
          message: `Searching for user by email: ${decodedToken.email}`,
        });
        user = await User.findOne({ email: decodedToken.email });

        if (user) {
          // User exists by email, link Firebase UID
          if (!user.firebaseUID) {
            user.firebaseUID = decodedToken.uid;
            await user.save();
            logger.info({
              operation,
              message: `Linked Firebase UID ${decodedToken.uid} to existing user ${user._id} with email ${user.email}`,
            });
          } else if (user.firebaseUID !== decodedToken.uid) {
            logger.warn({
              operation,
              message: `UID Conflict: User found by email ${user.email} but has different Firebase UID (${user.firebaseUID}). Token UID is ${decodedToken.uid}. Access denied.`,
              userId: user._id,
              existingFirebaseUID: user.firebaseUID,
              tokenFirebaseUID: decodedToken.uid,
            });
            return res
              .status(409)
              .json({ message: "Account conflict. Please contact support." });
          }
        } else {
          // User doesn't exist, create a new one
          logger.info({
            operation,
            message: `Creating new user for Firebase UID ${decodedToken.uid} and email ${decodedToken.email}`,
          });
          const { nanoid } = await import("nanoid");
          let uniqueCode = nanoid(10);
          while (await User.findOne({ referralCode: uniqueCode })) {
            logger.warn({
              operation,
              message: `Referral code collision detected for ${uniqueCode}, generating new one.`,
            });
            uniqueCode = nanoid(10);
          }
          const referralLink = `${
            process.env.ALLOWED_ORIGINS || "http://localhost:3000"
          }/register?ref=${uniqueCode}`;
          logger.info({
            operation,
            message: `Generated referral code ${uniqueCode} for new user.`,
          });

          user = new User({
            firebaseUID: decodedToken.uid,
            email: decodedToken.email,
            fullName:
              decodedToken.name || decodedToken.email?.split("@")[0] || "",
            referralCode: uniqueCode,
            referralLink: referralLink,
            registrationComplete: false,
          });

          await user.save();
          logger.info({
            operation,
            message: `New user created via Firebase: ${user.email}`,
            userId: user._id,
          });
        }
      }
      req.userDB = user; // Attach the MongoDB user document
    }

    if (!user) {
      logger.error({
        operation,
        message: "User object is unexpectedly null after token verification and lookup/creation logic",
        decodedToken: decodedToken,
      });
      return res
        .status(500)
        .json({ message: "Internal server error during user authentication." });
    }

    logger.info({
      operation,
      message: "User authenticated and database user attached.",
      userId: user._id,
    });

    next(); // Proceed to the next middleware or route handler
  } catch (error) {
    logger.error({
      operation,
      message: `Authentication error: ${error.message}`,
      error: error,
      stack: error.stack,
    });

    let responseMessage = "Unauthorized: Invalid or expired token";
    let statusCode = 401;
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      responseMessage = "Unauthorized: Invalid or expired JWT token";
    } else if (error.code === "auth/id-token-expired") {
      responseMessage = "Unauthorized: Firebase ID Token has expired";
    } else if (error.code === "auth/argument-error") {
      responseMessage = "Unauthorized: Invalid Firebase ID Token format";
    } else if (error.code) {
      responseMessage = `Unauthorized: ${error.message}`;
    } else {
      responseMessage = "Authentication failed.";
      statusCode = 500;
    }

    return res.status(statusCode).json({ message: responseMessage });
  }
};

module.exports = authenticateUser;
