const User = require("../models/User");

// 🔹 Get User Profile
exports.getProfile = async (req, res) => {
  res.json(req.userDB);
};

// 🔹 Update API Keys
exports.updateApiKeys = async (req, res) => {
  try {
    const { apiKey, apiSecretKey, fullName, telegramId } = req.body;

    const updates = {};

    if (apiKey) updates.apiKey = apiKey;
    if (apiSecretKey) updates.apiSecretKey = apiSecretKey;
    if (fullName) updates.fullName = fullName;
    if (telegramId) updates.telegramId = telegramId;

    const updatedUser = await User.findByIdAndUpdate(req.userDB._id, updates, {
      new: true,
    });

    res.json({
      message: "Profile updated successfully",
      user: updatedUser, // ✅ toJSON already strips sensitive fields
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 🔹 Get All Users (Admin Only)
exports.getUsers = async (req, res) => {
  try {
    const users = await User.find();
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
