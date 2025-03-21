const express = require("express");
const { getTrades, createTrade } = require("../controllers/tradeController");
const authenticateUser = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/:botInstanceId", authenticateUser, getTrades);
router.post("/", authenticateUser, createTrade);

module.exports = router;
