const express = require("express");
const {
  getNotifications,
  markNotificationRead,
} = require("../controllers/notificationController");
const authenticateUser = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", authenticateUser, getNotifications);
router.put("/:notificationId/read", authenticateUser, markNotificationRead);

module.exports = router;
