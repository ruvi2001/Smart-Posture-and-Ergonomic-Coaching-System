const mongoose = require("mongoose");
const { getSriLankaTimeString } = require("../utils/time");

const sensorReadingSchema = new mongoose.Schema(
  {
    session_id: {
      type: String,
      required: true
    },

    // ESP32 millis() / device timestamp.
    // Backend recorded_at_utc and recorded_at_sl are the reliable database timestamps.
    timestamp_device: {
      type: String,
      required: true
    },

    // UTC Date. Use this for sorting/filtering.
    recorded_at_utc: {
      type: Date,
      required: true,
      default: Date.now
    },

    // Sri Lankan local time string for display.
    recorded_at_sl: {
      type: String,
      required: true
    },

    timezone: {
      type: String,
      default: "Asia/Colombo"
    },

    // Correct FSR layout:
    // FSR1 = Front Right
    // FSR2 = Back Right
    // FSR3 = Back Left
    // FSR4 = Front Left
    fsr1_adc: { type: Number, required: true },
    fsr2_adc: { type: Number, required: true },
    fsr3_adc: { type: Number, required: true },
    fsr4_adc: { type: Number, required: true },

    // Estimated force values from ESP32.
    // Posture classification should use ADC values, not these estimated values.
    fsr1_force_g: { type: Number, required: true },
    fsr2_force_g: { type: Number, required: true },
    fsr3_force_g: { type: Number, required: true },
    fsr4_force_g: { type: Number, required: true },

    fsr1_pressure_pa: { type: Number, required: true },
    fsr2_pressure_pa: { type: Number, required: true },
    fsr3_pressure_pa: { type: Number, required: true },
    fsr4_pressure_pa: { type: Number, required: true },

    fsr1_pressure_kpa: { type: Number, required: true },
    fsr2_pressure_kpa: { type: Number, required: true },
    fsr3_pressure_kpa: { type: Number, required: true },
    fsr4_pressure_kpa: { type: Number, required: true },

    distance_cm: { type: Number, required: true },

    accel_x: { type: Number, required: true },
    accel_y: { type: Number, required: true },
    accel_z: { type: Number, required: true },

    total_force_g: { type: Number, required: true },
    total_pressure_pa: { type: Number, required: true },
    total_pressure_kpa: { type: Number, required: true },
    average_pressure_pa: { type: Number, default: 0 },
    average_pressure_kpa: { type: Number, default: 0 },

    // Grouped ADC values for explanation/debugging.
    front_pressure_adc: { type: Number, default: 0 }, // FSR1 + FSR4
    back_pressure_adc: { type: Number, default: 0 }, // FSR2 + FSR3
    left_pressure_adc: { type: Number, default: 0 }, // FSR4 + FSR3
    right_pressure_adc: { type: Number, default: 0 }, // FSR1 + FSR2
    total_adc: { type: Number, default: 0 },
    active_fsr_count: { type: Number, default: 0 },

    seat_balance_lr: { type: Number, required: true },
    seat_balance_fb: { type: Number, required: true },
    accel_deviation: { type: Number, default: 0 },

    is_occupied: { type: Boolean, required: true },

    // Kept only for old UI compatibility.
    posture_score: { type: Number, default: null },

    posture_status: {
      type: String,
      enum: ["not_occupied", "good_posture", "bad_posture"],
      required: true
    },

    bad_posture_type: {
      type: String,
      enum: [
        "none",
        "forward_slouching",
        "backward_slouching",
        "left_leaning",
        "right_leaning"
      ],
      required: true,
      default: "none"
    },

    bad_posture_types: {
      type: [String],
      default: []
    },

    posture_severity: {
      type: String,
      enum: ["none", "normal", "moderate", "severe"],
      default: "none"
    },

    posture_confidence: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium"
    },

    posture_reason: {
      type: String,
      default: ""
    },

    // Custom Sri Lankan display timestamps.
    // Mongoose createdAt/updatedAt are still UTC Date fields.
    created_at_sl: {
      type: String,
      default: null
    },

    updated_at_sl: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

sensorReadingSchema.pre("save", function (next) {
  const now = new Date();

  if (this.isNew && !this.created_at_sl) {
    this.created_at_sl = getSriLankaTimeString(now);
  }

  this.updated_at_sl = getSriLankaTimeString(now);

  next();
});

sensorReadingSchema.index({ recorded_at_utc: -1 });
sensorReadingSchema.index({ session_id: 1, recorded_at_utc: -1 });
sensorReadingSchema.index({
  posture_status: 1,
  bad_posture_type: 1,
  recorded_at_utc: -1
});

module.exports = mongoose.model("SensorReading", sensorReadingSchema);