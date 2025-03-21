const Referral = require("../models/Referral");

// 🔹 Get Referrals made by the User
exports.getReferrals = async (req, res) => {
  try {
    const referrals = await Referral.find({
      referrerId: req.userDB._id,
    }).populate("referredId", "email");
    res.json(referrals);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
