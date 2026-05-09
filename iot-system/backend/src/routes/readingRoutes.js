const express = require("express");
const {
  processReading,
  getLatestReading,
  getReadingHistory
} = require("../controllers/readingController");

const router = express.Router();

// Optional manual test endpoint. MQTT is still the real IoT ingestion path.
router.post("/process", async (req, res) => {
  try {
    const result = await processReading(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

router.get("/latest", getLatestReading);
router.get("/history", getReadingHistory);

module.exports = router;
