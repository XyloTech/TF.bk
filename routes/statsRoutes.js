const express = require("express");
const statsController = require("../controllers/statsController");
const authenticateUser = require("../middleware/authMiddleware");

const router = express.Router();

// GET /api/stats/trading - Fetches trading stats for the logged-in user
router.get("/trading", authenticateUser, statsController.getTradingStats);

// Add other stats routes here if needed in the future

module.exports = router;
