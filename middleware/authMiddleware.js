const admin = require("../config/firebase");
const User = require("../models/User");
const logger = require("../utils/logger");
const authenticateUser = async (req, res, next) => {
  const operation = "authenticateUser";
  try {
    const authHeader = req.headers.authorization;
    const idToken = authHeader?.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;

    if (!idToken) {
      logger.warn({ operation, message: "No token provided" });
      return res
        .status(401)
        .json({ message: "Unauthorized: No token provided" });
    }

    // logger.info({ operation, message: "Attempting to verify token..." }); // Can be verbose
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    logger.info({
      operation,
      message: "Token verified successfully",
      decodedUid: decodedToken.uid,
    });
    req.user = decodedToken; // Attach Firebase user info

    // --- User lookup/creation logic ---
    logger.info({
      operation,
      message: `Searching for user by firebaseUID: ${decodedToken.uid}`,
    });
    let user = await User.findOne({ firebaseUID: decodedToken.uid });

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
          // Don't generate referral code here, user already exists
          await user.save();
          logger.info({
            operation,
            message: `Linked Firebase UID ${decodedToken.uid} to existing user ${user._id} with email ${user.email}`,
          });
        } else if (user.firebaseUID !== decodedToken.uid) {
          // *** CRITICAL POLICY DECISION ***
          // Current: Warn and deny access (SAFER)
          logger.warn({
            operation,
            message: `UID Conflict: User found by email ${user.email} but has different Firebase UID (${user.firebaseUID}). Token UID is ${decodedToken.uid}. Access denied.`,
            userId: user._id,
            existingFirebaseUID: user.firebaseUID,
            tokenFirebaseUID: decodedToken.uid,
          });
          // Deny access in case of conflict
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
        // --- Generate Unique Referral Code for NEW User ---
        let uniqueCode = nanoid(10); // Adjust length as needed
        // Ensure uniqueness (rare collision chance, but good practice for production)
        while (await User.findOne({ referralCode: uniqueCode })) {
          logger.warn({
            operation,
            message: `Referral code collision detected for ${uniqueCode}, generating new one.`,
          });
          uniqueCode = nanoid(10);
        }
        const referralLink = `${
          process.env.ALLOWED_ORIGINS || "http://localhost:3000"
        }/signup?ref=${uniqueCode}`;
        logger.info({
          operation,
          message: `Generated referral code ${uniqueCode} for new user.`,
        });
        // --- End Referral Code Generation ---

        user = new User({
          firebaseUID: decodedToken.uid,
          email: decodedToken.email,
          fullName:
            decodedToken.name || decodedToken.email?.split("@")[0] || "", // Ensure fullName has a value
          referralCode: uniqueCode, // Assign generated code
          referralLink: referralLink, // Assign generated link
          registrationComplete: false, // Mark as needing registration completion
          // Add any other default fields needed for a new user
        });

        await user.save();
        logger.info({
          operation,
          message: `New user created via Firebase: ${user.email}`,
          userId: user._id,
        });
      }
    }

    // Check if user object exists before assigning and proceeding
    if (!user) {
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
      error: error.code ? { code: error.code } : error, // Log code if available, avoid full object in prod unless needed
    });

    let responseMessage = "Unauthorized: Invalid or expired token";
    let statusCode = 401;
    if (error.code === "auth/id-token-expired") {
      responseMessage = "Unauthorized: Token has expired";
    } else if (error.code === "auth/argument-error") {
      responseMessage = "Unauthorized: Invalid token format";
    } else if (error.code) {
      // Catch other specific Firebase auth errors if needed
      responseMessage = `Unauthorized: ${error.message}`;
    } else {
      // Handle non-Firebase errors during lookup/save perhaps
      responseMessage = "Authentication failed.";
      statusCode = 500; // Indicate server-side issue during auth flow
    }

    return res.status(statusCode).json({ message: responseMessage });
  }
};

module.exports = authenticateUser;
