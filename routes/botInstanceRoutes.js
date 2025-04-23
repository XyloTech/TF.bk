// routes/botInstanceRoutes.js
const express = require("express");
const {
  purchaseBot,
  getUserBots,
  updateBotInstanceKeys,
  // Import start/stop controllers
  startBotInstance,
  stopBotInstance,
} = require("../controllers/botInstanceController");
const authenticateUser = require("../middleware/authMiddleware");

const router = express.Router();

// POST /api/bot-instances/purchase
router.post("/purchase", authenticateUser, purchaseBot);

// GET /api/bot-instances/my-bots
router.get("/my-bots", authenticateUser, getUserBots);

// PUT /api/bot-instances/:botInstanceId/keys
router.put("/:botInstanceId/keys", authenticateUser, updateBotInstanceKeys);

// POST /api/bot-instances/:botInstanceId/start
router.post("/:botInstanceId/start", authenticateUser, startBotInstance);

// POST /api/bot-instances/:botInstanceId/stop
router.post("/:botInstanceId/stop", authenticateUser, stopBotInstance);

module.exports = router;
