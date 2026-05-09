const SensorReading = require("../models/SensorReading");
const AlertLog = require("../models/AlertLog");
const { calculatePosture } = require("../services/postureService");
const { updateSessionState } = require("../services/sessionService");
const { getSriLankaTimeString } = require("../utils/time");

const ALERT_COOLDOWN_SECONDS = Number(process.env.ALERT_COOLDOWN_SECONDS || 60);
const lastAlertBySessionAndType = new Map();
let latestLiveReading = null;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePayload(data) {
  return {
    // If ESP32 timestamp is missing or empty, use backend receive time.
    timestamp_device: String(data.timestamp_device || Date.now()),

    fsr1_adc: toNumber(data.fsr1_adc),
    fsr2_adc: toNumber(data.fsr2_adc),
    fsr3_adc: toNumber(data.fsr3_adc),
    fsr4_adc: toNumber(data.fsr4_adc),

    fsr1_force_g: toNumber(data.fsr1_force_g),
    fsr2_force_g: toNumber(data.fsr2_force_g),
    fsr3_force_g: toNumber(data.fsr3_force_g),
    fsr4_force_g: toNumber(data.fsr4_force_g),

    fsr1_pressure_pa: toNumber(data.fsr1_pressure_pa),
    fsr2_pressure_pa: toNumber(data.fsr2_pressure_pa),
    fsr3_pressure_pa: toNumber(data.fsr3_pressure_pa),
    fsr4_pressure_pa: toNumber(data.fsr4_pressure_pa),

    fsr1_pressure_kpa: toNumber(data.fsr1_pressure_kpa),
    fsr2_pressure_kpa: toNumber(data.fsr2_pressure_kpa),
    fsr3_pressure_kpa: toNumber(data.fsr3_pressure_kpa),
    fsr4_pressure_kpa: toNumber(data.fsr4_pressure_kpa),

    distance_cm: toNumber(data.distance_cm, -1),

    accel_x: toNumber(data.accel_x),
    accel_y: toNumber(data.accel_y),
    accel_z: toNumber(data.accel_z)
  };
}

async function createAlertIfNeeded(sessionId, posture, recordedAt) {
  try {
    if (posture.posture_status !== "bad_posture") return;

    const key = `${sessionId}:${posture.bad_posture_type}`;
    const nowMs = recordedAt.getTime();
    const lastMs = lastAlertBySessionAndType.get(key) || 0;

    if (nowMs - lastMs < ALERT_COOLDOWN_SECONDS * 1000) return;

    lastAlertBySessionAndType.set(key, nowMs);

    await AlertLog.create({
      session_id: sessionId,
      alert_type: "posture_warning",
      severity: posture.posture_severity === "severe" ? "high" : "medium",
      message: `Detected ${posture.bad_posture_types.join(", ")}: ${
        posture.posture_reason
      }`,
      bad_posture_type: posture.bad_posture_type,
      bad_posture_types: posture.bad_posture_types,
      recorded_at_utc: recordedAt,
      recorded_at_sl: getSriLankaTimeString(recordedAt),
      timezone: "Asia/Colombo"
    });
  } catch (error) {
    // Alert failure should not stop sensor reading saving.
    console.error("AlertLog save failed, but SensorReading was already saved.");
    console.error(error.message);
  }
}

const processReading = async (data) => {
  console.log("processReading() started");

  const requiredFields = [
    "fsr1_adc",
    "fsr2_adc",
    "fsr3_adc",
    "fsr4_adc",

    "distance_cm",

    "accel_x",
    "accel_y",
    "accel_z"
  ];

  for (const field of requiredFields) {
    if (data[field] === undefined || data[field] === null) {
      throw new Error(`Missing required MQTT field: ${field}`);
    }
  }

  const payload = normalizePayload(data);

  console.log("Normalized payload:");
  console.log({
    timestamp_device: payload.timestamp_device,
    fsr1_adc: payload.fsr1_adc,
    fsr2_adc: payload.fsr2_adc,
    fsr3_adc: payload.fsr3_adc,
    fsr4_adc: payload.fsr4_adc,
    distance_cm: payload.distance_cm,
    accel_x: payload.accel_x,
    accel_y: payload.accel_y,
    accel_z: payload.accel_z
  });

  const sessionState = await updateSessionState(
    payload.fsr1_adc,
    payload.fsr2_adc,
    payload.fsr3_adc,
    payload.fsr4_adc
  );

  console.log("Session state after updateSessionState():");
  console.log(sessionState);

  const livePosture = calculatePosture({
  ...payload,
  is_occupied: sessionState.is_occupied
});

latestLiveReading = {
  session_id: sessionState.session_id,
  timestamp_device: payload.timestamp_device,
  device_time_sl: data.device_time_sl || null,

  recorded_at_utc: new Date(),
  recorded_at_sl: getSriLankaTimeString(new Date()),
  timezone: "Asia/Colombo",

  fsr1_adc: payload.fsr1_adc,
  fsr2_adc: payload.fsr2_adc,
  fsr3_adc: payload.fsr3_adc,
  fsr4_adc: payload.fsr4_adc,

  fsr1_force_g: payload.fsr1_force_g,
  fsr2_force_g: payload.fsr2_force_g,
  fsr3_force_g: payload.fsr3_force_g,
  fsr4_force_g: payload.fsr4_force_g,

  fsr1_pressure_kpa: payload.fsr1_pressure_kpa,
  fsr2_pressure_kpa: payload.fsr2_pressure_kpa,
  fsr3_pressure_kpa: payload.fsr3_pressure_kpa,
  fsr4_pressure_kpa: payload.fsr4_pressure_kpa,

  distance_cm: payload.distance_cm,

  accel_x: payload.accel_x,
  accel_y: payload.accel_y,
  accel_z: payload.accel_z,

  total_adc: livePosture.total_adc,
  active_fsr_count: livePosture.active_fsr_count,

  seat_balance_lr: livePosture.seat_balance_lr,
  seat_balance_fb: livePosture.seat_balance_fb,
  accel_deviation: livePosture.accel_deviation,

  is_occupied: sessionState.is_occupied,

  posture_score: livePosture.posture_score,
  posture_status: livePosture.posture_status,
  bad_posture_type: livePosture.bad_posture_type,
  bad_posture_types: livePosture.bad_posture_types,
  posture_severity: livePosture.posture_severity,
  posture_confidence: livePosture.posture_confidence,
  posture_reason: livePosture.posture_reason,

  session_state: sessionState
};

  if (!sessionState.session_active || !sessionState.session_id) {
    return {
      success: true,
      message:
        "No active session. Reading received but not stored as posture data.",
      session_state: sessionState
    };
  }

  // Optional: do not save fully empty-chair readings.
  // The session timer still works because updateSessionState() already ran.
  if (sessionState.all_four_empty) {
    return {
      success: true,
      message:
        "Chair is empty. Reading used for session timer but not saved as posture data.",
      session_state: sessionState
    };
  }

  const totalForce =
    payload.fsr1_force_g +
    payload.fsr2_force_g +
    payload.fsr3_force_g +
    payload.fsr4_force_g;

  const totalPressurePa =
    payload.fsr1_pressure_pa +
    payload.fsr2_pressure_pa +
    payload.fsr3_pressure_pa +
    payload.fsr4_pressure_pa;

  const totalPressureKpa =
    payload.fsr1_pressure_kpa +
    payload.fsr2_pressure_kpa +
    payload.fsr3_pressure_kpa +
    payload.fsr4_pressure_kpa;

  const averagePressurePa = totalPressurePa / 4;
  const averagePressureKpa = totalPressureKpa / 4;

  const posture = calculatePosture({
    ...payload,
    is_occupied: sessionState.is_occupied
  });

  console.log("Posture result:");
  console.log(posture);

  const recordedAt = new Date();

  let reading;

  try {
    reading = await SensorReading.create({
      session_id: sessionState.session_id,

      timestamp_device: payload.timestamp_device,

      recorded_at_utc: recordedAt,
      recorded_at_sl: getSriLankaTimeString(recordedAt),
      timezone: "Asia/Colombo",

      fsr1_adc: payload.fsr1_adc,
      fsr2_adc: payload.fsr2_adc,
      fsr3_adc: payload.fsr3_adc,
      fsr4_adc: payload.fsr4_adc,

      fsr1_force_g: payload.fsr1_force_g,
      fsr2_force_g: payload.fsr2_force_g,
      fsr3_force_g: payload.fsr3_force_g,
      fsr4_force_g: payload.fsr4_force_g,

      fsr1_pressure_pa: payload.fsr1_pressure_pa,
      fsr2_pressure_pa: payload.fsr2_pressure_pa,
      fsr3_pressure_pa: payload.fsr3_pressure_pa,
      fsr4_pressure_pa: payload.fsr4_pressure_pa,

      fsr1_pressure_kpa: payload.fsr1_pressure_kpa,
      fsr2_pressure_kpa: payload.fsr2_pressure_kpa,
      fsr3_pressure_kpa: payload.fsr3_pressure_kpa,
      fsr4_pressure_kpa: payload.fsr4_pressure_kpa,

      distance_cm: payload.distance_cm,

      accel_x: payload.accel_x,
      accel_y: payload.accel_y,
      accel_z: payload.accel_z,

      total_force_g: totalForce,
      total_pressure_pa: totalPressurePa,
      total_pressure_kpa: totalPressureKpa,
      average_pressure_pa: averagePressurePa,
      average_pressure_kpa: averagePressureKpa,

      front_pressure_adc: posture.front_pressure_adc,
      back_pressure_adc: posture.back_pressure_adc,
      left_pressure_adc: posture.left_pressure_adc,
      right_pressure_adc: posture.right_pressure_adc,
      total_adc: posture.total_adc,
      active_fsr_count: posture.active_fsr_count,

      seat_balance_lr: posture.seat_balance_lr,
      seat_balance_fb: posture.seat_balance_fb,
      accel_deviation: posture.accel_deviation,

      is_occupied: sessionState.is_occupied,

      posture_score: posture.posture_score,
      posture_status: posture.posture_status,
      bad_posture_type: posture.bad_posture_type,
      bad_posture_types: posture.bad_posture_types,
      posture_severity: posture.posture_severity,
      posture_confidence: posture.posture_confidence,
      posture_reason: posture.posture_reason
    });

    console.log("SensorReading saved successfully:");
    console.log({
      _id: reading._id,
      session_id: reading.session_id,
      recorded_at_sl: reading.recorded_at_sl,
      posture_status: reading.posture_status,
      bad_posture_type: reading.bad_posture_type
    });
  } catch (error) {
    console.error("SensorReading save failed.");
    console.error("Error message:", error.message);

    if (error.errors) {
      console.error("Mongoose validation errors:");
      for (const [field, err] of Object.entries(error.errors)) {
        console.error(`- ${field}: ${err.message}`);
      }
    }

    throw error;
  }

  await createAlertIfNeeded(sessionState.session_id, posture, recordedAt);

  return {
    success: true,
    message: "Sensor reading saved successfully",
    session_state: sessionState,
    data: reading
  };
};

const getLatestReading = async (req, res) => {
  try {
    if (latestLiveReading) {
      return res.json({
        success: true,
        source: "live_mqtt",
        data: latestLiveReading
      });
    }

    const latest = await SensorReading.findOne().sort({
      recorded_at_utc: -1
    });

    res.json({
      success: true,
      source: "mongodb",
      data: latest
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch latest reading",
      error: error.message
    });
  }
};

const getReadingHistory = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);
    const postureStatus = req.query.posture_status;
    const badPostureType = req.query.bad_posture_type;
    const sessionId = req.query.session_id;

    const filter = {};

    if (postureStatus) filter.posture_status = postureStatus;
    if (badPostureType) filter.bad_posture_type = badPostureType;
    if (sessionId) filter.session_id = sessionId;

    const readings = await SensorReading.find(filter)
      .sort({ recorded_at_utc: -1 })
      .limit(limit);

    res.json({
      success: true,
      count: readings.length,
      data: readings
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch reading history",
      error: error.message
    });
  }
};

module.exports = {
  processReading,
  getLatestReading,
  getReadingHistory
};