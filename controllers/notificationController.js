const Notification = require("../models/Notification");

// 🔹 Get Notifications for User
exports.getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({
      userId: req.userDB._id,
    }).sort({ createdAt: -1 });
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 🔹 Mark Notification as Read
exports.markNotificationRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    await Notification.findByIdAndUpdate(notificationId, { read: true });
    res.json({ message: "Notification marked as read" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
