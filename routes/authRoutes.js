const express = require("express");
const authenticateUser = require("../middleware/authMiddleware");

const router = express.Router();

// 🔹 Firebase Authentication Route
router.post("/firebase-auth", authenticateUser, async (req, res) => {
  try {
    res.status(200).json({
      message: "User authenticated successfully",
      firebaseUID: req.user.firebaseUID,
      user: req.userDB,
    });
  } catch (error) {
    console.error("❌ Error in authentication route:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

module.exports = router;
