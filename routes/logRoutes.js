const express = require("express");
const router = express.Router();
const { getLogsForBot } = require("../controllers/logController");

router.get("/:botInstanceId", getLogsForBot);

module.exports = router;
