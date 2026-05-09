#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <time.h>

#define MQTT_MAX_PACKET_SIZE 2048
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_ADXL345_U.h>
#include <math.h>

// =====================================================
// Wi-Fi settings
// =====================================================
const char *WIFI_SSID = "Sasuke Uchiha";
const char *WIFI_PASSWORD = "hfkw2671";


// =====================================================
// MQTT settings
// =====================================================
// Must match backend/.env
const char *MQTT_BROKER = "broker.hivemq.com";
const int MQTT_PORT = 1883;
const char *MQTT_TOPIC = "posture/chair01/readings";

WiFiClient espClient;
PubSubClient mqttClient(espClient);

// =====================================================
// Correct FSR sensor layout
// =====================================================
// Based on your corrected sensor positions:
//
// FSR1 = FR = Front Right
// FSR2 = BR = Back Right
// FSR3 = BL = Back Left
// FSR4 = FL = Front Left
//
// Keep this mapping same in backend postureService.js.
const int FSR1_PIN = 36; // Front Right / VP
const int FSR2_PIN = 39; // Back Right  / VN
const int FSR3_PIN = 34; // Back Left   / GPIO34
const int FSR4_PIN = 35; // Front Left  / GPIO35

// =====================================================
// Ultrasonic sensor pins
// =====================================================
const int trigPin = 18;
const int echoPin = 5;

// =====================================================
// ADXL345 accelerometer
// =====================================================
Adafruit_ADXL345_Unified accel = Adafruit_ADXL345_Unified(12345);

// =====================================================
// Timing
// =====================================================
const unsigned long PUBLISH_INTERVAL_MS = 5000;
unsigned long lastPublishMs = 0;

// Sri Lanka time = UTC + 5:30
const long GMT_OFFSET_SECONDS = 5 * 3600 + 30 * 60;
const int DAYLIGHT_OFFSET_SECONDS = 0;

// =====================================================
// FSR force / pressure estimation
// =====================================================
// IMPORTANT:
// ADC values are used for posture classification.
// force_g and pressure_pa are estimated values only.
// For real accuracy, replace this table with calibration data
// collected using known weights on each FSR.
const int CAL_TABLE_SIZE = 10;

const int adcTable[CAL_TABLE_SIZE] = {
    0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 3800, 4095
};

const float forceTable_g[CAL_TABLE_SIZE] = {
    0.0f, 100.0f, 300.0f, 700.0f, 1200.0f,
    2000.0f, 3000.0f, 4500.0f, 6000.0f, 8000.0f
};

// Approximate active area of FSR402.
// Diameter around 12.7 mm.
const float FSR_RADIUS_M = 0.00635f;
const float FSR_AREA_M2 = 3.14159265f * FSR_RADIUS_M * FSR_RADIUS_M;

// =====================================================
// Device-side posture result structure
// =====================================================
struct PostureResult
{
    String postureStatus;     // good_posture, bad_posture, not_occupied
    String badPostureType;    // none, forward_slouching, backward_slouching, left_leaning, right_leaning
    String badPostureTypes;   // comma-separated list
    String severity;          // none, normal, moderate, severe
    String reason;            // explanation for Serial Monitor
    float frontBackBalance;
    float leftRightBalance;
};

// =====================================================
// Helper functions
// =====================================================
int readAverageADC(int pin, int samples = 10)
{
    long sum = 0;

    for (int i = 0; i < samples; i++)
    {
        sum += analogRead(pin);
        delay(2);
    }

    return (int)(sum / samples);
}

float interpolateADCToForce(int adcValue)
{
    if (adcValue <= adcTable[0])
    {
        return forceTable_g[0];
    }

    for (int i = 0; i < CAL_TABLE_SIZE - 1; i++)
    {
        int adcA = adcTable[i];
        int adcB = adcTable[i + 1];

        float forceA = forceTable_g[i];
        float forceB = forceTable_g[i + 1];

        if (adcValue >= adcA && adcValue <= adcB)
        {
            float ratio = (float)(adcValue - adcA) / (float)(adcB - adcA);
            return forceA + ratio * (forceB - forceA);
        }
    }

    return forceTable_g[CAL_TABLE_SIZE - 1];
}

float adcToForce_g(int adcValue)
{
    // Ignore tiny noise when no force is applied.
    if (adcValue < 80)
    {
        return 0.0f;
    }

    if (adcValue > 4095)
    {
        adcValue = 4095;
    }

    return interpolateADCToForce(adcValue);
}

float gramsToNewtons(float grams)
{
    return (grams / 1000.0f) * 9.80665f;
}

float force_gToPressurePa(float force_g)
{
    // pressure = force / area
    // Accuracy depends on proper force calibration.
    float forceN = gramsToNewtons(force_g);
    return forceN / FSR_AREA_M2;
}

float force_gToPressureKPa(float force_g)
{
    return force_gToPressurePa(force_g) / 1000.0f;
}

float getDistanceCm()
{
    digitalWrite(trigPin, LOW);
    delayMicroseconds(2);

    digitalWrite(trigPin, HIGH);
    delayMicroseconds(10);
    digitalWrite(trigPin, LOW);

    long duration = pulseIn(echoPin, HIGH, 30000);

    if (duration == 0)
    {
        return -1.0f; // no echo / timeout
    }

    return (duration * 0.0343f) / 2.0f;
}

String getDeviceUptimeMs()
{
    return String(millis());
}

String getSriLankaTimeString()
{
    struct tm timeinfo;

    if (!getLocalTime(&timeinfo, 1000))
    {
        return "NTP_NOT_SYNCED";
    }

    char buffer[24];
    strftime(buffer, sizeof(buffer), "%Y-%m-%d %H:%M:%S", &timeinfo);
    return String(buffer);
}

void appendPostureType(String &types, const String &type)
{
    if (types.length() > 0)
    {
        types += ", ";
    }

    types += type;
}

void appendReason(String &reason, const String &text)
{
    if (reason.length() > 0)
    {
        reason += "; ";
    }

    reason += text;
}

// =====================================================
// Device-side posture classification
// =====================================================
// This is only for Serial Monitor and debugging.
// Backend still stores the final result in MongoDB.
PostureResult classifyPostureOnDevice(
    int fsr1_adc, // Front Right
    int fsr2_adc, // Back Right
    int fsr3_adc, // Back Left
    int fsr4_adc, // Front Left
    float distance_cm,
    float accel_x,
    float accel_y,
    float accel_z)
{
    PostureResult result;

    // -------------------------------------------------
    // 1. Correct FSR grouping
    // -------------------------------------------------
    int frontRight = fsr1_adc;
    int backRight = fsr2_adc;
    int backLeft = fsr3_adc;
    int frontLeft = fsr4_adc;

    int front = frontRight + frontLeft; // FSR1 + FSR4
    int back = backRight + backLeft;    // FSR2 + FSR3

    int right = frontRight + backRight; // FSR1 + FSR2
    int left = frontLeft + backLeft;    // FSR4 + FSR3

    int total = front + back;

    // -------------------------------------------------
    // 2. Occupancy check
    // total_adc is used only to detect whether user is seated.
    // It is not used alone to decide posture type.
    // -------------------------------------------------
    int activeSensors = 0;

    if (fsr1_adc > 1000)
        activeSensors++;
    if (fsr2_adc > 1000)
        activeSensors++;
    if (fsr3_adc > 1000)
        activeSensors++;
    if (fsr4_adc > 1000)
        activeSensors++;

    if (total < 5000 || activeSensors < 2)
    {
        result.postureStatus = "not_occupied";
        result.badPostureType = "none";
        result.badPostureTypes = "none";
        result.severity = "none";
        result.reason = "Chair is not occupied";
        result.frontBackBalance = 0.0f;
        result.leftRightBalance = 0.0f;
        return result;
    }

    // Positive FB = more front pressure.
    // Negative FB = more back pressure.
    result.frontBackBalance = (float)(front - back) / (float)total;

    // Positive LR = more right pressure.
    // Negative LR = more left pressure.
    result.leftRightBalance = (float)(right - left) / (float)total;

    // -------------------------------------------------
    // 3. ADXL345 baseline values
    // -------------------------------------------------
    // Based on your good-posture observed values:
    // X around -9.8, Y around 0.0, Z around -0.9
    //
    // Y is the main forward/backward indicator.
    // X and Z are used as supporting deviation signals.
    const float BASELINE_X = -9.85f;
    const float BASELINE_Y = 0.05f;
    const float BASELINE_Z = -0.90f;

    float dx = accel_x - BASELINE_X;
    float dy = accel_y - BASELINE_Y;
    float dz = accel_z - BASELINE_Z;

    float accelDeviation = sqrt((dx * dx) + (dy * dy) + (dz * dz));

    // -------------------------------------------------
    // 4. Rule-based posture conditions
    // -------------------------------------------------

    // Forward slouch pattern:
    // - Ultrasonic distance around 30-45 cm
    // - accel_y positive
    // - front FSR values higher than normal
    bool forwardDistance =
        distance_cm >= 30.0f &&
        distance_cm <= 45.0f;

    bool forwardAccel =
        accel_y >= 0.35f ||
        (dy >= 0.30f && fabs(dz) >= 0.10f);

    bool forwardFSR =
        fsr1_adc >= 3000 &&
        fsr4_adc >= 3000 &&
        fsr2_adc >= 3500 &&
        fsr3_adc >= 3500 &&
        result.frontBackBalance > -0.08f;

    // Backward slouch pattern:
    // - Ultrasonic distance around 72-95 cm
    // - accel_y negative
    // - front sensors lower, back sensors high
    bool backwardDistance =
        distance_cm >= 72.0f &&
        distance_cm <= 95.0f;

    bool backwardAccel =
        accel_y <= -0.70f ||
        (dy <= -0.60f && accel_z <= -1.05f);

    bool backwardFSR =
        (
            fsr1_adc >= 1600 &&
            fsr1_adc <= 2400 &&
            fsr4_adc >= 1600 &&
            fsr4_adc <= 2400 &&
            fsr2_adc >= 3700 &&
            fsr3_adc >= 3700
        ) ||
        result.frontBackBalance <= -0.23f;

    // Right leaning:
    // right side pressure higher than left side pressure.
    bool rightLeaning =
        result.leftRightBalance >= 0.18f &&
        right > left &&
        (fsr1_adc > fsr4_adc || fsr2_adc > fsr3_adc);

    // Left leaning:
    // left side pressure higher than right side pressure.
    bool leftLeaning =
        result.leftRightBalance <= -0.18f &&
        left > right &&
        (fsr4_adc > fsr1_adc || fsr3_adc > fsr2_adc);

    // -------------------------------------------------
    // 5. Build result
    // Multiple posture issues can be detected together.
    // Example: forward_slouching + right_leaning
    // -------------------------------------------------
    String badTypes = "";
    String reason = "";

    if (forwardDistance || forwardAccel || forwardFSR)
    {
        appendPostureType(badTypes, "forward_slouching");

        if (forwardDistance)
            appendReason(reason, "Ultrasonic distance is in forward-slouch range");
        if (forwardAccel)
            appendReason(reason, "ADXL345 Y/Z deviation indicates forward tilt");
        if (forwardFSR)
            appendReason(reason, "FSR front pressure pattern supports forward slouch");
    }

    if (backwardDistance || backwardAccel || backwardFSR)
    {
        appendPostureType(badTypes, "backward_slouching");

        if (backwardDistance)
            appendReason(reason, "Ultrasonic distance is in backward-slouch range");
        if (backwardAccel)
            appendReason(reason, "ADXL345 Y/Z deviation indicates backward tilt");
        if (backwardFSR)
            appendReason(reason, "FSR back pressure pattern supports backward slouch");
    }

    if (rightLeaning)
    {
        appendPostureType(badTypes, "right_leaning");
        appendReason(reason, "Right-side FSR pressure is higher than left side");
    }

    if (leftLeaning)
    {
        appendPostureType(badTypes, "left_leaning");
        appendReason(reason, "Left-side FSR pressure is higher than right side");
    }

    if (badTypes.length() == 0)
    {
        result.postureStatus = "good_posture";
        result.badPostureType = "none";
        result.badPostureTypes = "none";
        result.severity = "normal";
        result.reason = "No bad-posture rule was triggered";
    }
    else
    {
        result.postureStatus = "bad_posture";
        result.badPostureTypes = badTypes;

        int commaIndex = badTypes.indexOf(",");
        if (commaIndex == -1)
        {
            result.badPostureType = badTypes;
        }
        else
        {
            result.badPostureType = badTypes.substring(0, commaIndex);
        }

        result.reason = reason;
        result.severity = "moderate";

        // Severe posture if the deviation is strong.
        if (
            distance_cm < 35.0f ||
            distance_cm > 85.0f ||
            fabs(accel_y) > 1.20f ||
            fabs(result.frontBackBalance) > 0.35f ||
            fabs(result.leftRightBalance) > 0.30f ||
            accelDeviation > 1.20f)
        {
            result.severity = "severe";
        }
    }

    return result;
}

// =====================================================
// Wi-Fi / MQTT
// =====================================================
void connectWiFi()
{
    if (WiFi.status() == WL_CONNECTED)
    {
        return;
    }

    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    Serial.print("Connecting to WiFi");

    while (WiFi.status() != WL_CONNECTED)
    {
        delay(500);
        Serial.print(".");
    }

    Serial.println();
    Serial.println("WiFi connected");
    Serial.print("ESP32 IP: ");
    Serial.println(WiFi.localIP());
}

void syncSriLankaTime()
{
    configTime(GMT_OFFSET_SECONDS, DAYLIGHT_OFFSET_SECONDS, "pool.ntp.org", "time.nist.gov");

    Serial.print("Syncing NTP time");

    struct tm timeinfo;
    int attempts = 0;

    while (!getLocalTime(&timeinfo, 1000) && attempts < 10)
    {
        Serial.print(".");
        attempts++;
    }

    Serial.println();

    if (attempts >= 10)
    {
        Serial.println("NTP time sync failed. Backend will still save Sri Lankan time.");
    }
    else
    {
        Serial.print("Device Sri Lanka time: ");
        Serial.println(getSriLankaTimeString());
    }
}

void reconnectMQTT()
{
    while (!mqttClient.connected())
    {
        Serial.print("Connecting to MQTT...");

        String clientId = "ESP32PostureClient-" + String(random(0xffff), HEX);

        if (mqttClient.connect(clientId.c_str()))
        {
            Serial.println("connected");
        }
        else
        {
            Serial.print("failed, rc=");
            Serial.print(mqttClient.state());
            Serial.println(" retrying in 5 seconds");
            delay(5000);
        }
    }
}

// =====================================================
// Setup
// =====================================================
void setup()
{
    Serial.begin(115200);
    delay(1000);

    Serial.println();
    Serial.println("======================================");
    Serial.println("SMART POSTURE SYSTEM STARTING");
    Serial.println("FSR1=FR, FSR2=BR, FSR3=BL, FSR4=FL");
    Serial.println("Serial Monitor posture output enabled");
    Serial.println("======================================");

    // I2C pins for ADXL345.
    Wire.begin(21, 22);

    // ESP32 ADC setup.
    analogReadResolution(12);
    analogSetPinAttenuation(FSR1_PIN, ADC_11db);
    analogSetPinAttenuation(FSR2_PIN, ADC_11db);
    analogSetPinAttenuation(FSR3_PIN, ADC_11db);
    analogSetPinAttenuation(FSR4_PIN, ADC_11db);

    pinMode(FSR1_PIN, INPUT);
    pinMode(FSR2_PIN, INPUT);
    pinMode(FSR3_PIN, INPUT);
    pinMode(FSR4_PIN, INPUT);

    pinMode(trigPin, OUTPUT);
    pinMode(echoPin, INPUT);
    digitalWrite(trigPin, LOW);

    if (!accel.begin())
    {
        Serial.println("ADXL345 not detected. Check SDA/SCL/VCC/GND wiring.");
    }
    else
    {
        accel.setRange(ADXL345_RANGE_16_G);
        Serial.println("ADXL345 ready.");
    }

    connectWiFi();
    syncSriLankaTime();

    mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
    mqttClient.setBufferSize(2048);

    Serial.println("System ready.");
}

// =====================================================
// Main loop
// =====================================================
void loop()
{
    if (WiFi.status() != WL_CONNECTED)
    {
        connectWiFi();
        syncSriLankaTime();
    }

    if (!mqttClient.connected())
    {
        reconnectMQTT();
    }

    mqttClient.loop();

    unsigned long now = millis();

    if (now - lastPublishMs < PUBLISH_INTERVAL_MS)
    {
        return;
    }

    lastPublishMs = now;

    // -------------------------------------------------
    // 1. Read FSR ADC values
    // -------------------------------------------------
    int fsr1_adc = readAverageADC(FSR1_PIN); // Front Right
    int fsr2_adc = readAverageADC(FSR2_PIN); // Back Right
    int fsr3_adc = readAverageADC(FSR3_PIN); // Back Left
    int fsr4_adc = readAverageADC(FSR4_PIN); // Front Left

    // -------------------------------------------------
    // 2. Estimate force and pressure
    // -------------------------------------------------
    float fsr1_force_g = adcToForce_g(fsr1_adc);
    float fsr2_force_g = adcToForce_g(fsr2_adc);
    float fsr3_force_g = adcToForce_g(fsr3_adc);
    float fsr4_force_g = adcToForce_g(fsr4_adc);

    float fsr1_pressure_pa = force_gToPressurePa(fsr1_force_g);
    float fsr2_pressure_pa = force_gToPressurePa(fsr2_force_g);
    float fsr3_pressure_pa = force_gToPressurePa(fsr3_force_g);
    float fsr4_pressure_pa = force_gToPressurePa(fsr4_force_g);

    float fsr1_pressure_kpa = fsr1_pressure_pa / 1000.0f;
    float fsr2_pressure_kpa = fsr2_pressure_pa / 1000.0f;
    float fsr3_pressure_kpa = fsr3_pressure_pa / 1000.0f;
    float fsr4_pressure_kpa = fsr4_pressure_pa / 1000.0f;

    // -------------------------------------------------
    // 3. Read ultrasonic distance
    // -------------------------------------------------
    float distance = getDistanceCm();

    // -------------------------------------------------
    // 4. Read ADXL345 accelerometer
    // -------------------------------------------------
    sensors_event_t event;

    float accel_x = 0.0f;
    float accel_y = 0.0f;
    float accel_z = 0.0f;

    if (accel.getEvent(&event))
    {
        accel_x = event.acceleration.x;
        accel_y = event.acceleration.y;
        accel_z = event.acceleration.z;
    }

    // -------------------------------------------------
    // 5. Classify posture locally for Serial Monitor
    // -------------------------------------------------
    PostureResult posture = classifyPostureOnDevice(
        fsr1_adc,
        fsr2_adc,
        fsr3_adc,
        fsr4_adc,
        distance,
        accel_x,
        accel_y,
        accel_z
    );

    // -------------------------------------------------
    // 6. Print readable output to Serial Monitor
    // -------------------------------------------------
    Serial.println("======================================");

    Serial.printf("Device SL time: %s\n", getSriLankaTimeString().c_str());

    Serial.printf("FSR ADCs:\n");
    Serial.printf("  FSR1 Front Right : %d\n", fsr1_adc);
    Serial.printf("  FSR2 Back Right  : %d\n", fsr2_adc);
    Serial.printf("  FSR3 Back Left   : %d\n", fsr3_adc);
    Serial.printf("  FSR4 Front Left  : %d\n", fsr4_adc);

    Serial.printf("FSR Force Est (g):\n");
    Serial.printf("  FSR1 FR: %.2f g\n", fsr1_force_g);
    Serial.printf("  FSR2 BR: %.2f g\n", fsr2_force_g);
    Serial.printf("  FSR3 BL: %.2f g\n", fsr3_force_g);
    Serial.printf("  FSR4 FL: %.2f g\n", fsr4_force_g);

    Serial.printf("FSR Pressure Est (kPa):\n");
    Serial.printf("  FSR1 FR: %.2f kPa\n", fsr1_pressure_kpa);
    Serial.printf("  FSR2 BR: %.2f kPa\n", fsr2_pressure_kpa);
    Serial.printf("  FSR3 BL: %.2f kPa\n", fsr3_pressure_kpa);
    Serial.printf("  FSR4 FL: %.2f kPa\n", fsr4_pressure_kpa);

    Serial.printf("Distance: %.2f cm\n", distance);
    Serial.printf("ADXL345: X=%.2f Y=%.2f Z=%.2f m/s^2\n", accel_x, accel_y, accel_z);

    Serial.println("---------- POSTURE RESULT ----------");
    Serial.printf("Posture Status : %s\n", posture.postureStatus.c_str());
    Serial.printf("Posture Type   : %s\n", posture.badPostureType.c_str());
    Serial.printf("All Issues     : %s\n", posture.badPostureTypes.c_str());
    Serial.printf("Severity       : %s\n", posture.severity.c_str());
    Serial.printf("FB Balance     : %.3f\n", posture.frontBackBalance);
    Serial.printf("LR Balance     : %.3f\n", posture.leftRightBalance);
    Serial.printf("Reason         : %s\n", posture.reason.c_str());
    Serial.println("------------------------------------");

    // -------------------------------------------------
    // 7. Build JSON payload for Node.js backend
    // -------------------------------------------------
    JsonDocument doc;

    // ESP32 device-side time fields.
    // Backend still stores proper MongoDB recorded_at_utc and recorded_at_sl.
    doc["timestamp_device"] = getDeviceUptimeMs();
    doc["device_time_sl"] = getSriLankaTimeString();

    // Raw ADC values.
    doc["fsr1_adc"] = fsr1_adc; // Front Right
    doc["fsr2_adc"] = fsr2_adc; // Back Right
    doc["fsr3_adc"] = fsr3_adc; // Back Left
    doc["fsr4_adc"] = fsr4_adc; // Front Left

    // Estimated force values.
    doc["fsr1_force_g"] = fsr1_force_g;
    doc["fsr2_force_g"] = fsr2_force_g;
    doc["fsr3_force_g"] = fsr3_force_g;
    doc["fsr4_force_g"] = fsr4_force_g;

    // Estimated pressure values.
    doc["fsr1_pressure_pa"] = fsr1_pressure_pa;
    doc["fsr2_pressure_pa"] = fsr2_pressure_pa;
    doc["fsr3_pressure_pa"] = fsr3_pressure_pa;
    doc["fsr4_pressure_pa"] = fsr4_pressure_pa;

    doc["fsr1_pressure_kpa"] = fsr1_pressure_kpa;
    doc["fsr2_pressure_kpa"] = fsr2_pressure_kpa;
    doc["fsr3_pressure_kpa"] = fsr3_pressure_kpa;
    doc["fsr4_pressure_kpa"] = fsr4_pressure_kpa;

    // Ultrasonic and accelerometer values.
    doc["distance_cm"] = distance;
    doc["accel_x"] = accel_x;
    doc["accel_y"] = accel_y;
    doc["accel_z"] = accel_z;

    // Device-side posture result.
    // These are mainly for debugging. Backend also classifies posture.
    doc["device_posture_status"] = posture.postureStatus;
    doc["device_bad_posture_type"] = posture.badPostureType;
    doc["device_bad_posture_types"] = posture.badPostureTypes;
    doc["device_posture_severity"] = posture.severity;
    doc["device_seat_balance_fb"] = posture.frontBackBalance;
    doc["device_seat_balance_lr"] = posture.leftRightBalance;
    doc["device_posture_reason"] = posture.reason;

    String payload;
    serializeJson(doc, payload);

    // -------------------------------------------------
    // 8. Publish to MQTT
    // -------------------------------------------------
    bool ok = mqttClient.publish(MQTT_TOPIC, payload.c_str());

    if (ok)
    {
        Serial.println("MQTT publish success");
    }
    else
    {
        Serial.println("MQTT publish failed");
    }

    // Print compact JSON payload for debugging.
    Serial.println("MQTT Payload:");
    Serial.println(payload);
}