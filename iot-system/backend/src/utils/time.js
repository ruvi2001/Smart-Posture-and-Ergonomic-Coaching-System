const SRI_LANKA_TIMEZONE = "Asia/Colombo";

/**
 * MongoDB Date fields are stored internally in UTC.
 * This helper gives a readable Sri Lankan local time string.
 *
 * Format:
 * YYYY-MM-DD HH:mm:ss
 */
function getSriLankaTimeString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SRI_LANKA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);

  const map = {};

  for (const part of parts) {
    map[part.type] = part.value;
  }

  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

module.exports = {
  SRI_LANKA_TIMEZONE,
  getSriLankaTimeString
};