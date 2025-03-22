const User = require("../models/User");

// 🔹 Get User Profile
exports.getProfile = async (req, res) => {
  res.json(req.userDB);
};

// 🔹 Update API Keys
exports.updateApiKeys = async (req, res) => {
  try {
    const { apiKey, apiSecretKey } = req.body;
    await User.findByIdAndUpdate(
      req.userDB._id,
      { apiKey, apiSecretKey },
      { new: true }
    );
    res.json({ message: "API keys updated successfully" });
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
