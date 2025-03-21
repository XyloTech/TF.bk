const express = require("express");
const {
  purchaseBot,
  getUserBots,
} = require("../controllers/botInstanceController");
const authenticateUser = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/purchase", authenticateUser, purchaseBot);
router.get("/my-bots", authenticateUser, getUserBots);

module.exports = router;
