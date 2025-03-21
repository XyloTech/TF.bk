const express = require("express");
const {
  getProfile,
  updateApiKeys,
  getUsers,
} = require("../controllers/userController");
const authenticateUser = require("../middleware/authMiddleware");
const isAdmin = require("../middleware/isAdmin");

const router = express.Router();

// 🔹 Get User Profile (Authenticated Users)
router.get("/profile", authenticateUser, getProfile);

// 🔹 Update API Keys (Authenticated Users)
router.put("/update-api-keys", authenticateUser, updateApiKeys);

// 🔹 Get All Users (Admin Only)
router.get("/admin/users", authenticateUser, isAdmin, getUsers);

module.exports = router;
