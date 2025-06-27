const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const authMiddleware = require('../middleware/authMiddleware');

// Route to place an order
router.post('/place-order', authMiddleware, orderController.placeOrder);

module.exports = router;