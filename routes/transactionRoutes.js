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
 main
router.get("/wallet-amounts", authenticateUser, rechargeAmount); // Add this route

router.get("/recharge-amount", authenticateUser, rechargeAmount);
 master

module.exports = router;
