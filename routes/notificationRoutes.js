const express = require("express");
const {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = require("../controllers/notificationController");
const authenticateUser = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", authenticateUser, getNotifications);
router.put("/:notificationId/read", authenticateUser, markNotificationRead);
// Add this route
router.put("/read-all", authenticateUser, markAllNotificationsRead);
module.exports = router;
