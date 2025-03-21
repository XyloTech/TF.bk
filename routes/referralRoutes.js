const express = require("express");
const { getReferrals } = require("../controllers/referralController");
const authenticateUser = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", authenticateUser, getReferrals);

module.exports = router;
