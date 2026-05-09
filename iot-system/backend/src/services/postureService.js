/**
 * Rule-based posture classification service.
 *
 * IMPORTANT SENSOR LAYOUT USED BY THIS PROJECT:
 *   FSR1 = FR = Front Right
 *   FSR4 = FL = Front Left
 *   FSR2 = BR = Back Right
 *   FSR3 = BL = Back Left
 *
 * The posture decision is based on experimentally observed prototype ranges:
 *   - Good posture: front FSRs around 2600-3000, back FSRs around 3600-4000,
 *     distance around 50-70 cm, accel_y near 0.
 *   - Forward slouch: distance around 30-45 cm and/or positive accel_y.
 *   - Backward slouch: distance above ~72 cm, negative accel_y, and/or strong back pressure.
 *   - Left/right leaning: detected using left-right FSR imbalance.
 *
 * Do not treat these thresholds as medical/ergonomic standards. They are prototype
 * calibration ranges and should be tuned using more collected readings.
 */

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, decimals = 3) {
  return Number(Number(value).toFixed(decimals));
}

function between(value, min, max) {
  return value >= min && value <= max;
}

function calculatePosture(reading = {}) {
  // Correct FSR position mapping.
  const fsr1 = toNumber(reading.fsr1_adc); // Front Right
  const fsr2 = toNumber(reading.fsr2_adc); // Back Right
  const fsr3 = toNumber(reading.fsr3_adc); // Back Left
  const fsr4 = toNumber(reading.fsr4_adc); // Front Left

  const distanceCm = toNumber(reading.distance_cm, -1);
  const accelX = toNumber(reading.accel_x);
  const accelY = toNumber(reading.accel_y);
  const accelZ = toNumber(reading.accel_z);

  // Occupancy gate: this is only used to decide whether a person is seated.
  // It is NOT used by itself to decide posture type.
  const occupiedSensorThreshold = toNumber(process.env.FSR_OCCUPIED_ADC_THRESHOLD, 1000);
  const occupiedTotalThreshold = toNumber(process.env.FSR_TOTAL_OCCUPIED_THRESHOLD, 5000);

  const frontRight = fsr1;
  const backRight = fsr2;
  const backLeft = fsr3;
  const frontLeft = fsr4;

  // Group FSR values by real physical position.
  const front = frontRight + frontLeft; // FSR1 + FSR4
  const back = backRight + backLeft;    // FSR2 + FSR3
  const right = frontRight + backRight; // FSR1 + FSR2
  const left = frontLeft + backLeft;    // FSR4 + FSR3
  const total = front + back;

  const activeSensors = [fsr1, fsr2, fsr3, fsr4].filter(
    (v) => v >= occupiedSensorThreshold
  ).length;

  const isOccupied = total >= occupiedTotalThreshold && activeSensors >= 2;

  if (!isOccupied) {
    return {
      posture_score: null,
      posture_status: "not_occupied",
      bad_posture_type: "none",
      bad_posture_types: [],
      posture_severity: "none",
      posture_confidence: "high",
      seat_balance_lr: 0,
      seat_balance_fb: 0,
      front_pressure_adc: front,
      back_pressure_adc: back,
      left_pressure_adc: left,
      right_pressure_adc: right,
      total_adc: total,
      active_fsr_count: activeSensors,
      accel_deviation: 0,
      posture_reason: "Chair is not occupied or pressure is below the occupied threshold"
    };
  }

  // Normalized balance values allow comparison across users with different weights.
  // Positive FB = more front pressure. Negative FB = more back pressure.
  const seatBalanceFB = total > 0 ? (front - back) / total : 0;
  // Positive LR = more right pressure. Negative LR = more left pressure.
  const seatBalanceLR = total > 0 ? (right - left) / total : 0;

  // Thresholds are configurable from .env so you can tune them after testing.
  const lrThreshold = toNumber(process.env.POSTURE_LR_THRESHOLD, 0.18);
  const forwardDistanceMin = toNumber(process.env.POSTURE_FORWARD_DISTANCE_MIN_CM, 30);
  const forwardDistanceMax = toNumber(process.env.POSTURE_FORWARD_DISTANCE_MAX_CM, 45);
  const backwardDistanceMin = toNumber(process.env.POSTURE_BACKWARD_DISTANCE_MIN_CM, 72);
  const backwardDistanceMax = toNumber(process.env.POSTURE_BACKWARD_DISTANCE_MAX_CM, 95);
  const forwardAccelYThreshold = toNumber(process.env.POSTURE_FORWARD_ACCEL_Y, 0.35);
  const backwardAccelYThreshold = toNumber(process.env.POSTURE_BACKWARD_ACCEL_Y, -0.70);
  const backwardFbThreshold = toNumber(process.env.POSTURE_BACKWARD_FB_BALANCE, -0.23);
  const forwardFbThreshold = toNumber(process.env.POSTURE_FORWARD_FB_BALANCE, -0.08);

  // Baseline values from the observed good-posture readings.
  // X is close to -9.8 because the ADXL345 X-axis is aligned with gravity in your mounting.
  const baselineX = toNumber(process.env.ACCEL_BASELINE_X, -9.85);
  const baselineY = toNumber(process.env.ACCEL_BASELINE_Y, 0.05);
  const baselineZ = toNumber(process.env.ACCEL_BASELINE_Z, -0.90);

  const dx = accelX - baselineX;
  const dy = accelY - baselineY;
  const dz = accelZ - baselineZ;
  const accelDeviation = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Individual FSR range checks based on your collected prototype readings.
  // These are supporting signals. Distance + accelerometer are more reliable for forward/backward.
  const goodFsrRange =
    between(fsr1, 2500, 3100) && // FR
    between(fsr4, 2500, 3100) && // FL
    between(fsr2, 3500, 4050) && // BR
    between(fsr3, 3500, 4050);   // BL

  const forwardFsrRange =
    between(fsr1, 3000, 3600) && // FR
    between(fsr4, 3000, 3600) && // FL
    between(fsr2, 3500, 4050) && // BR
    between(fsr3, 3500, 4050);   // BL

  const backwardFsrRange =
    between(fsr1, 1600, 2400) && // FR
    between(fsr4, 1600, 2400) && // FL
    between(fsr2, 3700, 4050) && // BR
    between(fsr3, 3700, 4050);   // BL

  const goodDistance = between(distanceCm, 50, 70);
  const goodAccel =
    between(accelX, -10.10, -9.60) &&
    between(accelY, -0.20, 0.20) &&
    between(accelZ, -1.10, -0.70);

  // Forward slouch signals.
  const forwardDistance = between(distanceCm, forwardDistanceMin, forwardDistanceMax);
  const forwardAccel =
    accelY >= forwardAccelYThreshold ||
    (dy >= 0.30 && Math.abs(dz) >= 0.10);
  const forwardFsrSupport = forwardFsrRange && seatBalanceFB > forwardFbThreshold;

  // Backward slouch signals.
  const backwardDistance = between(distanceCm, backwardDistanceMin, backwardDistanceMax);
  const backwardAccel =
    accelY <= backwardAccelYThreshold ||
    (dy <= -0.60 && accelZ <= -1.05);
  const backwardFsrSupport = backwardFsrRange || seatBalanceFB <= backwardFbThreshold;

  // Leaning signals use separate left/right FSR positions.
  const rightLeaning =
    seatBalanceLR >= lrThreshold &&
    right > left &&
    fsr1 > fsr4 &&
    fsr2 > fsr3;

  const leftLeaning =
    seatBalanceLR <= -lrThreshold &&
    left > right &&
    fsr4 > fsr1 &&
    fsr3 > fsr2;

  const badTypes = [];
  const reasons = [];

  if (rightLeaning) {
    badTypes.push("right_leaning");
    reasons.push("Right-side FSR pressure is higher than left-side pressure");
  }

  if (leftLeaning) {
    badTypes.push("left_leaning");
    reasons.push("Left-side FSR pressure is higher than right-side pressure");
  }

  // For forward/backward, use sensor agreement where possible.
  // A single strong signal can classify posture, but the reason explains which signal triggered it.
  if (forwardDistance || forwardAccel || forwardFsrSupport) {
    badTypes.push("forward_slouching");

    if (forwardDistance) reasons.push("Ultrasonic distance is in the forward-slouch range");
    if (forwardAccel) reasons.push("ADXL345 Y-axis/deviation indicates forward tilt");
    if (forwardFsrSupport) reasons.push("FSR pattern shows front pressure shift compared with normal posture");
  }

  if (backwardDistance || backwardAccel || backwardFsrSupport) {
    badTypes.push("backward_slouching");

    if (backwardDistance) reasons.push("Ultrasonic distance is in the backward-slouch range");
    if (backwardAccel) reasons.push("ADXL345 Y-axis/Z-axis deviation indicates backward tilt");
    if (backwardFsrSupport) reasons.push("FSR pattern shows strong back pressure compared with normal posture");
  }

  const uniqueBadTypes = [...new Set(badTypes)];

  if (uniqueBadTypes.length === 0) {
    return {
      // The score is kept only for backward compatibility with old UI/API code.
      // The final decision should use posture_status + bad_posture_type(s), not posture_score.
      posture_score: 100,
      posture_status: "good_posture",
      bad_posture_type: "none",
      bad_posture_types: [],
      posture_severity: "normal",
      posture_confidence: goodFsrRange && goodDistance && goodAccel ? "high" : "medium",
      seat_balance_lr: round(seatBalanceLR),
      seat_balance_fb: round(seatBalanceFB),
      front_pressure_adc: front,
      back_pressure_adc: back,
      left_pressure_adc: left,
      right_pressure_adc: right,
      total_adc: total,
      active_fsr_count: activeSensors,
      accel_deviation: round(accelDeviation),
      posture_reason: "No bad-posture rule was triggered; sensor values are within acceptable prototype ranges"
    };
  }

  let postureSeverity = "moderate";
  if (
    distanceCm < 35 ||
    distanceCm > 85 ||
    Math.abs(accelY) > 1.20 ||
    Math.abs(seatBalanceFB) > 0.35 ||
    Math.abs(seatBalanceLR) > 0.30 ||
    accelDeviation > 1.20
  ) {
    postureSeverity = "severe";
  }

  return {
    posture_score: postureSeverity === "severe" ? 40 : 70,
    posture_status: "bad_posture",
    bad_posture_type: uniqueBadTypes[0],
    bad_posture_types: uniqueBadTypes,
    posture_severity: postureSeverity,
    posture_confidence: uniqueBadTypes.length > 1 ? "high" : "medium",
    seat_balance_lr: round(seatBalanceLR),
    seat_balance_fb: round(seatBalanceFB),
    front_pressure_adc: front,
    back_pressure_adc: back,
    left_pressure_adc: left,
    right_pressure_adc: right,
    total_adc: total,
    active_fsr_count: activeSensors,
    accel_deviation: round(accelDeviation),
    posture_reason: reasons.join("; ")
  };
}

module.exports = {
  calculatePosture
};
