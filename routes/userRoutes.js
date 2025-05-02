// routes/userRoutes.js
const express = require("express");
const userController = require("../controllers/userController");
const authenticateUser = require("../middleware/authMiddleware");
const isAdmin = require("../middleware/isAdmin"); // Your working isAdmin middleware

const router = express.Router();

// --- Routes for the Authenticated User (/me) ---

// GET /api/users/me (Replaces your old GET /profile)
// Fetches the logged-in user's profile
router.get("/me", authenticateUser, userController.getProfile);

// PUT /api/users/me (Replaces your old PUT /profile)
// Updates the logged-in user's profile (limited fields like name, telegramId)
router.put("/me", authenticateUser, userController.updateProfile);

// POST /api/users/me/complete-registration (NEW - For Referrals)
// Processes referral code after first login, marks registration complete
router.post(
  "/me/complete-registration",
  authenticateUser,
  userController.completeRegistration
);

// GET /api/users/me/referral-info (NEW - For Referrals)
// Gets the logged-in user's referral code/link/stats
router.get(
  "/me/referral-info",
  authenticateUser,
  userController.getMyReferralInfo
);

// --- Admin Routes ---

// GET /api/users (Replaces your old GET /admin/users)
// Admin route to get all users, protected by isAdmin
router.get("/", authenticateUser, isAdmin, userController.getUsers);

module.exports = router;
