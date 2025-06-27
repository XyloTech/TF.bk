const express = require("express");
const { getBots, createBot, getBotById } = require("../controllers/botController");
const authenticateUser = require("../middleware/authMiddleware");
const isAdmin = require("../middleware/isAdmin");

const router = express.Router();

router.get("/", getBots);
router.post("/", authenticateUser, isAdmin, createBot); // 🔹 Admin only
router.get("/:id", getBotById); // 🔹 Get bot by ID

module.exports = router;
