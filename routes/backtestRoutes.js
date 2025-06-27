const express = require('express');
const router = express.Router();
const backtestController = require('../controllers/backtestController');
const authMiddleware = require('../middleware/authMiddleware');

// Route to start a backtest
router.post('/start', authMiddleware, backtestController.startBacktest);

module.exports = router;