// controllers/userController.js
const User = require("../models/User"); // Assuming your User model path is correct

// 🔹 Get User Profile
// Fetches the profile for the currently authenticated user (populated by auth middleware)
exports.getProfile = async (req, res) => {
  // req.userDB is the authenticated user document.
  // Sensitive fields should already be removed by the User model's 'toJSON' transform.
  if (!req.userDB) {
    // This case might indicate an issue with the auth middleware
    return res
      .status(401)
      .json({ message: "Authentication error: User not found." });
  }
  res.json(req.userDB);
};

// 🔹 Update User Profile (Non-sensitive fields like Full Name, Telegram ID)
// Renamed from updateApiKeys, and removed API key logic.
exports.updateProfile = async (req, res) => {
  try {
    // Only allow updating specific, non-sensitive fields from the request body
    const { fullName, telegramId } = req.body;
    const userId = req.userDB._id; // Get user ID from authenticated user object

    const updates = {};

    // Build the updates object, trimming string inputs
    if (typeof fullName === "string") {
      updates.fullName = fullName.trim();
    }
    if (typeof telegramId === "string") {
      // You might add validation for Telegram ID format if needed
      updates.telegramId = telegramId.trim();
    }
    // Add other fields here that are safe to update via this endpoint
    // e.g., notification preferences, etc.

    // Check if there are any fields to update
    if (Object.keys(updates).length === 0) {
      return res
        .status(400)
        .json({ message: "No valid fields provided for update." });
    }

    // Find the user by their ID and update only the specified fields using $set
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updates },
      {
        new: true, // Return the updated document
        runValidators: true, // Ensure model validations are checked
        context: "query", // Important for some validators
      }
    );

    if (!updatedUser) {
      // Should not happen if auth middleware worked, but good practice to check
      return res.status(404).json({ message: "User not found." });
    }

    // updatedUser will have sensitive fields removed by 'toJSON'
    res.json({
      message: "Profile updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Error updating user profile:", error);
    // Handle specific Mongoose validation errors
    if (error.name === "ValidationError") {
      return res
        .status(400)
        .json({ message: "Validation failed", errors: error.errors });
    }
    // Handle other potential errors
    res
      .status(500)
      .json({ message: "Failed to update profile due to a server error." });
  }
};

// 🔹 Get All Users (Admin Only)
// Ensure you have middleware (e.g., isAdmin) protecting this route
exports.getUsers = async (req, res) => {
  try {
    // Consider adding pagination for large user bases: .limit(X).skip(Y)
    // Consider selecting only necessary fields: .select('fullName email role status createdAt')
    const users = await User.find({}).sort({ createdAt: -1 }); // Example: sort by newest first

    // Users automatically transformed by toJSON
    res.json({ success: true, users });
  } catch (error) {
    console.error("Error fetching users (admin):", error);
    res.status(500).json({ message: "Failed to retrieve users." });
  }
};
