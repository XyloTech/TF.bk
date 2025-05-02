const Notification = require("../models/Notification");
const { formatDistanceToNowStrict } = require("date-fns"); // npm install date-fns

exports.getNotifications = async (req, res) => {
  try {
    const notificationsFromDB = await Notification.find({
      userId: req.userDB._id,
    })
      .sort({ createdAt: -1 })
      .limit(50) // Add a limit for performance!
      .lean(); // Use lean for plain JS objects

    // Transform the data for the frontend
    const formattedNotifications = notificationsFromDB.map((n) => {
      // Basic transformation - customize as needed based on 'type'
      let title = "Notification";
      let description = n.message;
      switch (n.type) {
        case "low_balance":
          title = "Low Balance Warning";
          break;
        case "trade_update":
          title = "Trade Update"; // You might parse n.message for more detail
          break;
        case "system_alert":
          title = "System Alert";
          break;
        // Add cases for other types (e.g., 'bot_status', 'referral_bonus')
      }

      return {
        id: n._id, // Use MongoDB _id
        title: title,
        description: description,
        // Format timestamp into readable relative time
        time: formatDistanceToNowStrict(new Date(n.createdAt), {
          addSuffix: true,
        }),
        unread: !n.read, // Convert 'read' (true/false) to 'unread' (true/false)
      };
    });

    // Also get the unread count efficiently
    const unreadCount = await Notification.countDocuments({
      userId: req.userDB._id,
      read: false,
    });

    res.json({
      notifications: formattedNotifications,
      unreadCount: unreadCount, // Send count to frontend
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ message: "Failed to retrieve notifications." });
  }
};

// 🔹 Mark Notification as Read
exports.markNotificationRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.userDB._id; // Get the logged-in user's ID

    // Find the notification by ID AND ensure it belongs to the current user
    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, userId: userId }, // Match both ID and user
      { $set: { read: true } }, // Use $set for clarity
      { new: false } // Optional: return original doc if needed, 'false' is slightly faster if you don't need the updated doc back
    );

    if (!notification) {
      // Notification not found OR didn't belong to the user
      return res
        .status(404)
        .json({ message: "Notification not found or access denied." });
    }

    // Optional: Send a socket event back if you want the UI to update in other open tabs
    // sendNotification(userId.toString(), 'notification_read', { notificationId });

    res.json({ message: "Notification marked as read" });
  } catch (error) {
    console.error("Error marking notification read:", error);
    // Handle potential CastError if notificationId format is wrong
    if (error.name === "CastError") {
      return res
        .status(400)
        .json({ message: "Invalid notification ID format." });
    }
    res.status(500).json({ message: "Failed to mark notification as read." });
  }
};

exports.markAllNotificationsRead = async (req, res) => {
  try {
    const userId = req.userDB._id;
    const result = await Notification.updateMany(
      { userId: userId, read: false }, // Filter by user and unread status
      { $set: { read: true } }
    );

    // Optional: Send socket event
    // sendNotification(userId.toString(), 'notifications_read_all', { count: result.modifiedCount });

    res.json({
      message: `Marked ${result.modifiedCount} notifications as read.`,
    });
  } catch (error) {
    console.error("Error marking all notifications read:", error);
    res
      .status(500)
      .json({ message: "Failed to mark all notifications as read." });
  }
};
