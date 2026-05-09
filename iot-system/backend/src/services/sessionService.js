const Session = require("../models/Session");
const { getSriLankaTimeString } = require("../utils/time");

/**
 * Correct FSR layout:
 *
 * FSR1 = Front Right
 * FSR2 = Back Right
 * FSR3 = Back Left
 * FSR4 = Front Left
 *
 * Session behavior:
 *
 * START:
 *   Session starts only when all 4 FSR sensors detect pressure.
 *
 * DURING SESSION:
 *   Sensor readings are stored while the user is sitting.
 *
 * EMPTY GRACE PERIOD:
 *   If all 4 FSR sensors become empty, the session does not end immediately.
 *   The backend continues storing readings for SESSION_END_MINUTES.
 *
 * END:
 *   If all 4 FSR sensors stay empty continuously for SESSION_END_MINUTES,
 *   the session is ended and future empty readings are not stored.
 */

function envNumber(name, fallback) {
  const raw = process.env[name];

  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }

  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Session starts only when all 4 FSR sensors are above this ADC value.
const FSR_SESSION_START_ADC_THRESHOLD = envNumber(
  "FSR_SESSION_START_ADC_THRESHOLD",
  1000
);

// Empty means all 4 FSR sensors are at or below this value.
// Use 0 only if your empty sensors really show exact 0.
// If they show small noise, use 50 or 80.
const FSR_EMPTY_ADC_THRESHOLD = envNumber("FSR_EMPTY_ADC_THRESHOLD", 80);

// Keep storing empty-chair readings for this long before ending the session.
const SESSION_END_MINUTES = envNumber("SESSION_END_MINUTES", 5);

let currentSessionId = null;
let sessionActive = false;
let emptyStartTime = null;
let initialized = false;

function getFsrSessionState(fsr1_adc, fsr2_adc, fsr3_adc, fsr4_adc) {
  const fsr1 = toNumber(fsr1_adc); // Front Right
  const fsr2 = toNumber(fsr2_adc); // Back Right
  const fsr3 = toNumber(fsr3_adc); // Back Left
  const fsr4 = toNumber(fsr4_adc); // Front Left

  const values = [fsr1, fsr2, fsr3, fsr4];
  const totalAdc = values.reduce((sum, value) => sum + value, 0);

  const activeSensorCount = values.filter(
    (value) => value >= FSR_SESSION_START_ADC_THRESHOLD
  ).length;

  const emptySensorCount = values.filter(
    (value) => value <= FSR_EMPTY_ADC_THRESHOLD
  ).length;

  const allFourHavePressure = activeSensorCount === 4;
  const allFourAreEmpty = emptySensorCount === 4;
  const anySensorHasPressure = values.some(
    (value) => value > FSR_EMPTY_ADC_THRESHOLD
  );

  return {
    fsr1_adc: fsr1,
    fsr2_adc: fsr2,
    fsr3_adc: fsr3,
    fsr4_adc: fsr4,

    totalAdc,
    activeSensorCount,
    emptySensorCount,

    allFourHavePressure,
    allFourAreEmpty,
    anySensorHasPressure
  };
}

/**
 * Load active session after backend restart.
 * This avoids creating duplicate sessions if Node.js restarts.
 */
async function initializeSessionState() {
  if (initialized) return;

  const activeSession = await Session.findOne({ is_active: true }).sort({
    start_time: -1
  });

  if (activeSession) {
    currentSessionId = activeSession.session_id;
    sessionActive = true;
    emptyStartTime = null;

    console.log(`Recovered active session: ${currentSessionId}`);
  }

  initialized = true;
}

async function startSession() {
  const now = new Date();
  const sessionId = `session_${Date.now()}`;

  await Session.create({
    session_id: sessionId,

    // MongoDB Date is stored as UTC.
    start_time: now,

    // Sri Lankan display time.
    start_time_sl: getSriLankaTimeString(now),

    timezone: "Asia/Colombo",
    is_active: true,
    duration_seconds: 0
  });

  currentSessionId = sessionId;
  sessionActive = true;
  emptyStartTime = null;

  console.log(
    `Session started: ${sessionId} at ${getSriLankaTimeString(now)} SL time`
  );

  return sessionId;
}

async function endSession() {
  if (!currentSessionId) return null;

  const endedSessionId = currentSessionId;

  const session = await Session.findOne({
    session_id: endedSessionId,
    is_active: true
  });

  const endTime = new Date();

  if (session) {
    const durationSeconds = Math.floor((endTime - session.start_time) / 1000);

    // MongoDB Date is UTC.
    session.end_time = endTime;

    // Sri Lankan display time.
    session.end_time_sl = getSriLankaTimeString(endTime);

    session.duration_seconds = durationSeconds;
    session.is_active = false;

    await session.save();
  }

  console.log(
    `Session ended: ${endedSessionId} at ${getSriLankaTimeString(endTime)} SL time`
  );

  currentSessionId = null;
  sessionActive = false;
  emptyStartTime = null;

  return endedSessionId;
}

/**
 * Main function called for every MQTT reading.
 *
 * Important return fields:
 *
 * reading_session_id:
 *   The session_id that the current reading should be stored under.
 *
 * should_store_reading:
 *   true  = store current sensor reading in MongoDB
 *   false = ignore current reading
 *
 * is_occupied:
 *   true  = user is currently sitting
 *   false = chair is empty, but session may still be in 5-minute grace period
 */
async function updateSessionState(fsr1_adc, fsr2_adc, fsr3_adc, fsr4_adc) {
  await initializeSessionState();

  const fsrState = getFsrSessionState(
    fsr1_adc,
    fsr2_adc,
    fsr3_adc,
    fsr4_adc
  );

  let readingSessionId = currentSessionId;
  let shouldStoreReading = false;
  let sessionJustStarted = false;
  let sessionJustEnded = false;
  let endedSessionId = null;

  // --------------------------------------------------
  // 1. Start session
  // --------------------------------------------------
  if (!sessionActive && fsrState.allFourHavePressure) {
    readingSessionId = await startSession();
    sessionJustStarted = true;
  }

  // Refresh after possible start.
  readingSessionId = currentSessionId;

  // --------------------------------------------------
  // 2. If session is active, store readings
  // --------------------------------------------------
  if (sessionActive && currentSessionId) {
    shouldStoreReading = true;
    readingSessionId = currentSessionId;
  }

  // --------------------------------------------------
  // 3. Empty-chair grace period
  // --------------------------------------------------
  if (sessionActive && fsrState.allFourAreEmpty) {
    if (!emptyStartTime) {
      emptyStartTime = new Date();

      console.log(
        `Chair empty. Started ${SESSION_END_MINUTES}-minute grace period for session ${currentSessionId}.`
      );
    }

    const emptyDurationMs = new Date() - emptyStartTime;
    const requiredEmptyMs = SESSION_END_MINUTES * 60 * 1000;

    // During the grace period, keep storing readings under same session.
    shouldStoreReading = true;
    readingSessionId = currentSessionId;

    // End only after continuous empty period is completed.
    if (emptyDurationMs >= requiredEmptyMs) {
      endedSessionId = currentSessionId;

      // Store the current final empty reading under the old session_id.
      readingSessionId = endedSessionId;
      shouldStoreReading = true;

      await endSession();
      sessionJustEnded = true;
    }
  } else {
    // If pressure returns before 5 minutes, cancel the empty timer.
    if (emptyStartTime && sessionActive) {
      console.log(
        `Pressure detected again. Cancelled empty-chair timer for session ${currentSessionId}.`
      );
    }

    emptyStartTime = null;
  }

  const emptySeconds = emptyStartTime
    ? Math.floor((new Date() - emptyStartTime) / 1000)
    : 0;

  return {
    session_id: currentSessionId,
    reading_session_id: readingSessionId,

    session_active: sessionActive,
    session_just_started: sessionJustStarted,
    session_just_ended: sessionJustEnded,
    ended_session_id: endedSessionId,

    // User is physically sitting only when not all sensors are empty.
    is_occupied: sessionActive && !fsrState.allFourAreEmpty,

    // This controls whether readingController stores the current reading.
    should_store_reading: shouldStoreReading,

    // Empty grace period information.
    in_empty_grace_period:
      Boolean(emptyStartTime) && shouldStoreReading && fsrState.allFourAreEmpty,

    empty_seconds: emptySeconds,
    empty_seconds_remaining: emptyStartTime
      ? Math.max(SESSION_END_MINUTES * 60 - emptySeconds, 0)
      : 0,

    total_adc: fsrState.totalAdc,
    active_fsr_count: fsrState.activeSensorCount,
    empty_fsr_count: fsrState.emptySensorCount,

    all_four_have_pressure: fsrState.allFourHavePressure,
    all_four_empty: fsrState.allFourAreEmpty,
    any_sensor_has_pressure: fsrState.anySensorHasPressure,

    session_start_threshold: FSR_SESSION_START_ADC_THRESHOLD,
    session_empty_threshold: FSR_EMPTY_ADC_THRESHOLD,
    session_end_minutes: SESSION_END_MINUTES
  };
}

module.exports = {
  updateSessionState,
  initializeSessionState,
  getFsrSessionState,

  // Alias for older code compatibility.
  getOccupancyState: getFsrSessionState
};