const express = require("express");
const authController = require("../controllers/authController");
const authenticateUser = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/firebase-auth", authenticateUser, authController.firebaseAuth);

module.exports = router;
