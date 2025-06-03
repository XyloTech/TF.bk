const Referral = require("../models/Referral");

// 🔹 Get Referrals made by the User
exports.getReferrals = async (req, res) => {
  try {
    console.log("Fetching referrals for user:", req.userDB._id);
    const referrals = await Referral.find({
      referrerId: req.userDB._id,
    }).populate("referredId", "email");
    res.json(referrals);
    // res.json({ message: "Referrals fetched successfully", referrals });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
