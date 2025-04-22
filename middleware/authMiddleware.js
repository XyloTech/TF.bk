const admin = require("../config/firebase");
const User = require("../models/User");
const logger = require("../utils/logger"); // Ensure this path is correct

const authenticateUser = async (req, res, next) => {
  const operation = "authenticateUser"; // For consistent log context
  try {
    const authHeader = req.headers.authorization;
    const idToken = authHeader?.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null; // Safer split

    if (!idToken) {
      logger.warn({ operation, message: "No token provided" });
      return res
        .status(401)
        .json({ message: "Unauthorized: No token provided" });
    }

    logger.info({ operation, message: "Attempting to verify token..." });
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    // 1. Log decodedToken content (be mindful of sensitive data in production logs if any)
    logger.info({
      operation,
      message: "Token verified successfully",
      decodedUid: decodedToken.uid,
      decodedEmail: decodedToken.email, // Log only necessary parts
    });
    req.user = decodedToken; // Attach Firebase user info

    // --- User lookup/creation logic ---
    logger.info({
      operation,
      message: `Searching for user by firebaseUID: ${decodedToken.uid}`,
    });
    let user = await User.findOne({ firebaseUID: decodedToken.uid });

    // 2. Log finding by UID
    logger.info({
      operation,
      message: user
        ? `User found by firebaseUID: ${user._id}`
        : "User not found by firebaseUID",
    });

    if (!user) {
      logger.info({
        operation,
        message: `Searching for user by email: ${decodedToken.email}`,
      });
      // 3. Log finding by email
      user = await User.findOne({ email: decodedToken.email });
      logger.info({
        operation,
        message: user
          ? `User found by email: ${user._id}`
          : "User not found by email",
      });

      if (user) {
        // User exists by email, link Firebase UID
        if (!user.firebaseUID) {
          user.firebaseUID = decodedToken.uid;
          await user.save();
          // 4. Log after linking
          logger.info({
            operation,
            message: `Linked Firebase UID ${decodedToken.uid} to existing user ${user._id} with email ${user.email}`,
          });
        } else if (user.firebaseUID !== decodedToken.uid) {
          // This scenario might need admin intervention or specific handling
          logger.warn({
            operation,
            message: `User found by email ${user.email} but already has a different Firebase UID (${user.firebaseUID}). Current token UID is ${decodedToken.uid}. Not linking automatically.`,
            userId: user._id,
            existingFirebaseUID: user.firebaseUID,
            tokenFirebaseUID: decodedToken.uid,
          });
          // Decide how to handle this case: Maybe deny access, maybe proceed without linking?
          // For now, let's proceed but log a warning. If access should be denied, return an error here.
        }
      } else {
        // User doesn't exist, create a new one
        logger.info({
          operation,
          message: `Creating new user for Firebase UID ${decodedToken.uid} and email ${decodedToken.email}`,
        });
        user = new User({
          firebaseUID: decodedToken.uid,
          email: decodedToken.email,
          fullName: decodedToken.name || decodedToken.email || "", // Ensure fullName has a value
          // Add any other default fields needed for a new user
        });

        await user.save();
        // 5. Log after new user creation
        logger.info({
          operation,
          message: `New user created via Firebase: ${user.email}`,
          userId: user._id,
        });
      }
    }

    // Check if user object exists before assigning and proceeding
    if (!user) {
      // This should theoretically not happen if the logic above is correct, but acts as a failsafe
      logger.error({
        operation,
        message: "User object is unexpectedly null after lookup/creation logic",
        decodedUid: decodedToken.uid,
      });
      return res
        .status(500)
        .json({ message: "Internal server error during user authentication." });
    }

    req.userDB = user; // Attach the MongoDB user document

    // 6. Crucially: Log before calling next()
    logger.info({
      operation,
      message: "User authenticated and database user attached. Calling next()",
      userId: user._id, // Confirm the ID being passed
      userEmail: user.email,
    });

    next(); // Proceed to the next middleware or route handler
  } catch (error) {
    // 7. Crucially: Log the error in the catch block
    logger.error({
      operation,
      message: `Authentication error: ${error.message}`,
      error: error, // Log the full error object for stack trace etc.
      errorCode: error.code, // Firebase errors often have a code
      stack: error.stack, // Include stack trace
    });

    // Provide slightly more specific error messages based on Firebase error codes if possible
    let responseMessage = "Unauthorized: Invalid or expired token";
    if (error.code === "auth/id-token-expired") {
      responseMessage = "Unauthorized: Token has expired";
    } else if (error.code === "auth/argument-error") {
      responseMessage = "Unauthorized: Invalid token format";
    }

    return res.status(401).json({ message: responseMessage });
  }
};

module.exports = authenticateUser;
