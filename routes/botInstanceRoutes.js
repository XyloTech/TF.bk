const express = require("express");
const {
  purchaseBot,
  getUserBots,
  // ⬇️ Import the new controller function
  updateBotInstanceKeys,
} = require("../controllers/botInstanceController");
const authenticateUser = require("../middleware/authMiddleware");

const router = express.Router();

// POST /api/bot-instances/purchase (Route to create a new instance)
router.post("/purchase", authenticateUser, purchaseBot);

// GET /api/bot-instances/my-bots (Route to get instances for logged-in user)
router.get("/my-bots", authenticateUser, getUserBots);

// --- 👇 ADD THIS ROUTE ---
// PUT /api/bot-instances/:botInstanceId/keys (Route to update keys for a specific instance)
router.put("/:botInstanceId/keys", authenticateUser, updateBotInstanceKeys);

module.exports = router;
