const mqtt = require("mqtt");
const { processReading } = require("../controllers/readingController");

const MQTT_BROKER_URL =
  process.env.MQTT_BROKER_URL || "mqtt://broker.hivemq.com:1883";

const MQTT_TOPIC = process.env.MQTT_TOPIC || "posture/chair01/readings";

const startMqttSubscriber = () => {
  const client = mqtt.connect(MQTT_BROKER_URL, {
    reconnectPeriod: 5000,
    connectTimeout: 30000
  });

  client.on("connect", () => {
    console.log(`Connected to MQTT broker: ${MQTT_BROKER_URL}`);

    client.subscribe(MQTT_TOPIC, (err) => {
      if (err) {
        console.error("MQTT subscription error:", err);
      } else {
        console.log(`Subscribed to topic: ${MQTT_TOPIC}`);
      }
    });
  });

  client.on("message", async (topic, message) => {
    try {
      const raw = message.toString();
      const payload = JSON.parse(raw);

      console.log("\n================ MQTT MESSAGE ================");
      console.log(`Topic: ${topic}`);
      console.log("Payload received from ESP32:");
      console.log(payload);

      const result = await processReading(payload);

      console.log("MQTT reading processed:");
      console.log({
        success: result.success,
        message: result.message,
        session_id: result.session_state?.session_id,
        session_active: result.session_state?.session_active,
        saved_reading_id: result.data?._id || null
      });

      console.log("=============================================\n");
    } catch (error) {
      console.error("\n========== MQTT MESSAGE PROCESSING ERROR ==========");
      console.error("Error message:", error.message);

      // This is important for Mongoose validation errors.
      if (error.errors) {
        console.error("Validation errors:");
        for (const [field, err] of Object.entries(error.errors)) {
          console.error(`- ${field}: ${err.message}`);
        }
      }

      console.error("Full error:");
      console.error(error);
      console.error("===================================================\n");
    }
  });

  client.on("error", (error) => {
    console.error("MQTT client error:", error);
  });

  client.on("reconnect", () => {
    console.log("MQTT reconnecting...");
  });

  return client;
};

module.exports = startMqttSubscriber;