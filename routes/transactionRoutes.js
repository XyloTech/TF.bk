const express = require("express");
const {
  getTransactions,
  createTransaction,
} = require("../controllers/transactionController");
const authenticateUser = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", authenticateUser, getTransactions);
router.post("/", authenticateUser, createTransaction);

module.exports = router;
