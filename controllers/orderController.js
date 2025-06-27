const axios = require('axios');
const logger = require('../utils/logger');

const placeOrder = async (req, res) => {
    const { symbol, side, type, quantity, price, timeInForce } = req.body;

    // Basic validation
    if (!symbol || !side || !type || !quantity) {
        return res.status(400).json({ message: 'Missing required order parameters.' });
    }

    // Binance API key and secret should be loaded from environment variables
    const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
    const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET;
    const BINANCE_BASE_URL = process.env.BINANCE_BASE_URL || 'https://api.binance.com';

    if (!BINANCE_API_KEY || !BINANCE_API_SECRET) {
        logger.error('Binance API key or secret not configured.');
        return res.status(500).json({ message: 'Binance API credentials not set.' });
    }

    // Construct the order payload
    const orderPayload = {
        symbol: symbol.toUpperCase(),
        side: side.toUpperCase(),
        type: type.toUpperCase(),
        quantity: parseFloat(quantity),
    };

    if (type.toUpperCase() === 'LIMIT') {
        if (!price || !timeInForce) {
            return res.status(400).json({ message: 'Limit orders require price and timeInForce.' });
        }
        orderPayload.price = parseFloat(price);
        orderPayload.timeInForce = timeInForce.toUpperCase();
    }

    // Binance API requires a signature for authenticated endpoints
    // This is a simplified example and does not include proper signing logic.
    // In a real application, you would need to implement HMAC SHA256 signing.
    // For now, we'll just send the API key.
    // TODO: Implement proper Binance API signing.

    try {
        const response = await axios.post(`${BINANCE_BASE_URL}/api/v3/order`, orderPayload, {
            headers: {
                'X-MBX-APIKEY': BINANCE_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        logger.info(`Order placed successfully: ${JSON.stringify(response.data)}`);
        res.status(200).json(response.data);
    } catch (error) {
        logger.error(`Error placing order: ${error.message}`);
        if (error.response) {
            logger.error(`Binance API error: ${JSON.stringify(error.response.data)}`);
            return res.status(error.response.status).json(error.response.data);
        } else {
            return res.status(500).json({ message: 'Failed to place order', error: error.message });
        }
    }
};

module.exports = {
    placeOrder,
};