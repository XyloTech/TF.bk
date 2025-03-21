const admin = require("../config/firebase");
const User = require("../models/User");
const logger = require("../utils/logger");

const authenticateUser = async (req, res, next) => {
  try {
    const idToken = req.headers.authorization?.split(" ")[1];

    if (!idToken) {
      logger.warn("No token provided");
      return res
        .status(401)
        .json({ message: "Unauthorized: No token provided" });
    }

    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;

    // First check by firebaseUID
    let user = await User.findOne({ firebaseUID: decodedToken.uid });

    if (!user) {
      // Check if user already exists by email
      user = await User.findOne({ email: decodedToken.email });

      if (user) {
        // Update the existing user with firebaseUID if not set
        if (!user.firebaseUID) {
          user.firebaseUID = decodedToken.uid;
          await user.save();
          logger.info(
            `Linked Firebase UID to existing email user: ${user.email}`
          );
        }
      } else {
        // Create new user
        user = new User({
          firebaseUID: decodedToken.uid,
          email: decodedToken.email,
          fullName: decodedToken.name || "",
        });

        await user.save();
        logger.info(`New user created via Firebase: ${decodedToken.email}`);
      }
    }

    req.userDB = user;
    next();
  } catch (error) {
    logger.error(`Authentication error: ${error.message}`);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

module.exports = authenticateUser;
