const admin = require("firebase-admin");
const User = require("../models/User");

exports.firebaseAuth = async (req, res) => {
  console.log("Full request body in firebaseAuth:", req.body);
  console.log("Full request headers in firebaseAuth:", req.headers);

  let idToken;
 main
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    idToken = req.headers.authorization.split('Bearer ')[1];

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer ")
  ) {
    idToken = req.headers.authorization.split("Bearer ")[1];
 master
  } else if (req.body.idToken) {
    idToken = req.body.idToken;
  }

 main
  console.log("Received idToken in firebaseAuth:", idToken ? "Token received (truncated): " + idToken.substring(0, 20) + "..." : "No token");

  console.log(
    "Received idToken in firebaseAuth:",
    idToken
      ? "Token received (truncated): " + idToken.substring(0, 20) + "..."
      : "No token"
  );
 master

  if (!idToken) {
    return res.status(400).json({ message: "Missing Firebase ID token" });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
 main
    console.log("Decoded Firebase token:", { uid: decoded.uid, email: decoded.email, name: decoded.name });
    const email = decoded.email;
    const firebaseUID = decoded.uid;

    console.log("Decoded Firebase token:", {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
    });
    const email = decoded.email;
    const firebaseUID = decoded.uid;
    console.log("here is firebaseUID", email, firebaseUID);
 master

    if (!email || !firebaseUID) {
      return res.status(401).json({ message: "Invalid Firebase token" });
    }

    let user = await User.findOne({ firebaseUID });

    if (!user || !user.firebaseUID) {
      console.error("❌ User is missing firebaseUID:", user);
 main
      return res.status(404).json({ message: "User not found or missing firebaseUID after Firebase authentication." });
    } else {
      console.log("Existing user found in DB:", { id: user._id, email: user.email });
    }

    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      { userId: user._id, firebaseUID: user.firebaseUID },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }

      return res.status(404).json({
        message:
          "User not found or missing firebaseUID after Firebase authentication.",
      });
    } else {
      console.log("Existing user found in DB:", {
        id: user._id,
        email: user.email,
      });
    }

    const jwt = require("jsonwebtoken");
    const token = jwt.sign(
      { userId: user._id, firebaseUID: user.firebaseUID },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
 master
    );

    return res.status(200).json({
      user: {
        id: user._id,
        email: user.email,
        firebaseUID: user.firebaseUID,
        registrationComplete: true,
        balance: user.accountBalance,
      },
      message: "Authentication successful",
      token: token,
    });
    console.log("✅ Sending auth response:", {
      user: {
        id: user._id,
        email: user.email,
        firebaseUID: user.firebaseUID,
        registrationComplete: true,
        balance: user.accountBalance,
      },
      token: token,
    });
 main

  } catch (err) {
    console.error("🔥 Firebase Auth Error:", err);  // 🔍 Full error log

  } catch (err) {
    console.error("🔥 Firebase Auth Error:", err); // 🔍 Full error log
 master
    return res.status(500).json({
      message: "Authentication failed",
      error: err.message || "Unknown error",
    });
  }
 main
};

};
 master
