const mongoose = require("mongoose");
const { getSriLankaTimeString } = require("../utils/time");

const alertLogSchema = new mongoose.Schema(
  {
    session_id: {
      type: String,
      required: true
    },

    alert_type: {
      type: String,
      required: true
    },

    severity: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium"
    },

    message: {
      type: String,
      required: true
    },

    bad_posture_type: {
      type: String,
      default: "none"
    },

    bad_posture_types: {
      type: [String],
      default: []
    },

    // UTC Date for database sorting/filtering.
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

alertLogSchema.pre("save", function (next) {
  const now = new Date();

  if (this.isNew && !this.created_at_sl) {
    this.created_at_sl = getSriLankaTimeString(now);
  }

  this.updated_at_sl = getSriLankaTimeString(now);

  next();
});

alertLogSchema.index({ session_id: 1, recorded_at_utc: -1 });
alertLogSchema.index({ severity: 1, recorded_at_utc: -1 });

module.exports = mongoose.model("AlertLog", alertLogSchema);