const express = require("express");
const {
  getTransactions,
  createTransaction,
  rechargeAmount, // Add this line
} = require("../controllers/transactionController");
const authenticateUser = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", authenticateUser, getTransactions);
router.post("/", authenticateUser, createTransaction);
router.get("/wallet-amounts", authenticateUser, rechargeAmount); // Add this route

module.exports = router;
