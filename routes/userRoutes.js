const express = require("express");
const {
  getProfile,
  // ⬇️ Use the correct controller function name
  updateProfile,
  getUsers,
} = require("../controllers/userController");
const authenticateUser = require("../middleware/authMiddleware");
const isAdmin = require("../middleware/isAdmin"); // Assuming you have this middleware

const router = express.Router();

// GET /api/users/profile (Get profile for logged-in user)
router.get("/profile", authenticateUser, getProfile);

// --- 👇 CORRECTED THIS ROUTE ---
// PUT /api/users/profile (Update profile details like name, telegramId)
// Changed path from /update-api-keys to /profile
// Changed controller from updateApiKeys to updateProfile
router.put("/profile", authenticateUser, updateProfile);

// GET /api/users/admin/users (Admin route to get all users)
// Path is fine, ensure isAdmin middleware works correctly
router.get("/admin/users", authenticateUser, isAdmin, getUsers); // Make sure isAdmin middleware exists and works

module.exports = router;
