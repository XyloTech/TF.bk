// routes/chartRoutes.js
const express = require("express");
const chartController = require("../controllers/chartController");
const authenticateUser = require("../middleware/authMiddleware"); // Assuming you have this

const router = express.Router();

// GET /api/charts/performance/:botInstanceId?granularity=daily&period=30d
router.get(
  "/performance/:botInstanceId",
  authenticateUser, // Ensure user is logged in and owns the instance
  chartController.getPerformanceChartData
);

module.exports = router;
