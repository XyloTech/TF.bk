// routes/botInstanceRoutes.js
const express = require("express");
const {
  purchaseBot,
  getUserBots,
  updateBotInstanceKeys,
  startBotInstance,
  stopBotInstance,
  getBotInstanceConfigDetails, // <--- IMPORT NEW CONTROLLER
} = require("../controllers/botInstanceController");
const authenticateUser = require("../middleware/authMiddleware");

const router = express.Router();

// ... (existing routes for purchase, my-bots, keys, start, stop - KEEP AS IS) ...
// POST /api/bot-instances/purchase
router.post("/purchase", authenticateUser, purchaseBot);

// GET /api/bot-instances/my-bots
router.get("/my-bots", authenticateUser, getUserBots);

// PUT /api/bot-instances/:botInstanceId/keys  (This endpoint now also handles telegramId update for the instance)
router.put("/:botInstanceId/keys", authenticateUser, updateBotInstanceKeys);

// POST /api/bot-instances/:botInstanceId/start
router.post("/:botInstanceId/start", authenticateUser, startBotInstance);

// POST /api/bot-instances/:botInstanceId/stop
router.post("/:botInstanceId/stop", authenticateUser, stopBotInstance);

// GET /api/bot-instances/:botInstanceId/details-for-config  <--- ADD NEW ROUTE
router.get(
  "/:botInstanceId/details-for-config",
  authenticateUser,
  getBotInstanceConfigDetails
);

module.exports = router;
