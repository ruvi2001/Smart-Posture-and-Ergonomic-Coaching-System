const express = require("express");
const cors = require("cors");

const readingRoutes = require("./routes/readingRoutes");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.send("Smart Posture Backend API is running");
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    service: "smart-posture-backend",
    status: "running",
    timezone: "Asia/Colombo"
  });
});

app.use("/api/readings", readingRoutes);

module.exports = app;
