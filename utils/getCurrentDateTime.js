// utils/getCurrentDateTime.js
// Returns "YYYY-MM-DD HH:MM:SS" in the specified IANA timezone (default: Asia/Manila)

require('dotenv').config();

function getCurrentDateTime(tz = process.env.APP_TZ || 'Asia/Manila') {
  const now = new Date();

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23', // 24h format
  }).formatToParts(now);

  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  // map = { year:'2025', month:'08', day:'20', hour:'14', minute:'05', second:'09', ... }
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

module.exports = getCurrentDateTime;
