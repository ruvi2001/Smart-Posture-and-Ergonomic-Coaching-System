require("dotenv").config();

const app = require("./app");
const connectDB = require("./config/db");
const startMqttSubscriber = require("./config/mqtt");
const { initializeSessionState } = require("./services/sessionService");

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();
  await initializeSessionState();

  // MQTT is the live IoT ingestion channel from ESP32.
  startMqttSubscriber();

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
  });
};

startServer().catch((error) => {
  console.error("Server startup failed:", error.message);
  process.exit(1);
});
