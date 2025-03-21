const express = require("express");
const { getBots, createBot } = require("../controllers/botController");
const authenticateUser = require("../middleware/authMiddleware");
const isAdmin = require("../middleware/isAdmin");

const router = express.Router();

router.get("/", getBots);
router.post("/", authenticateUser, isAdmin, createBot); // 🔹 Admin only

module.exports = router;
