'use strict';

/**
 * Manual readings seeder for ONLY meter_id = 'MTR-1' (electric).
 * - Inserts daily values from 2024-11-21 to 2025-02-20 (inclusive).
 * - Idempotent: skips any (meter_id, lastread_date) that already exist.
 * - MSSQL-safe; continues MR-<n> numbering from current max.
 *
 * Run:
 *   npx sequelize-cli db:seed --seed seeders/<timestamp>-seed-readings-mtr1-manual.js
 */

const METER_ID = 'MTR-1';

// --- EDIT BELOW IF YOU WANT TO CHANGE NUMBERS/DATES -------------------------
const MANUAL_READINGS = {
  // Daily from 2024-11-21 to 2025-02-20
  // Anchors: 2024-12-31 -> 9660.00, 2025-01-31 -> 9694.00, 2025-02-20 -> 9715.00
  '2024-11-21': 9588.00,
  '2024-11-22': 9589.80,
  '2024-11-23': 9591.60,
  '2024-11-24': 9593.40,
  '2024-11-25': 9595.20,
  '2024-11-26': 9597.00,
  '2024-11-27': 9598.80,
  '2024-11-28': 9600.60,
  '2024-11-29': 9602.40,
  '2024-11-30': 9604.20,
  '2024-12-01': 9606.00,
  '2024-12-02': 9607.80,
  '2024-12-03': 9609.60,
  '2024-12-04': 9611.40,
  '2024-12-05': 9613.20,
  '2024-12-06': 9615.00,
  '2024-12-07': 9616.80,
  '2024-12-08': 9618.60,
  '2024-12-09': 9620.40,
  '2024-12-10': 9622.20,
  '2024-12-11': 9624.00,
  '2024-12-12': 9625.80,
  '2024-12-13': 9627.60,
  '2024-12-14': 9629.40,
  '2024-12-15': 9631.20,
  '2024-12-16': 9633.00,
  '2024-12-17': 9634.80,
  '2024-12-18': 9636.60,
  '2024-12-19': 9638.40,
  '2024-12-20': 9640.20,
  '2024-12-21': 9642.00,
  '2024-12-22': 9643.80,
  '2024-12-23': 9645.60,
  '2024-12-24': 9647.40,
  '2024-12-25': 9649.20,
  '2024-12-26': 9651.00,
  '2024-12-27': 9652.80,
  '2024-12-28': 9654.60,
  '2024-12-29': 9656.40,
  '2024-12-30': 9658.20,
  '2024-12-31': 9660.00,
  '2025-01-01': 9661.10,
  '2025-01-02': 9662.19,
  '2025-01-03': 9663.29,
  '2025-01-04': 9664.39,
  '2025-01-05': 9665.48,
  '2025-01-06': 9666.58,
  '2025-01-07': 9667.68,
  '2025-01-08': 9668.77,
  '2025-01-09': 9669.87,
  '2025-01-10': 9670.97,
  '2025-01-11': 9672.06,
  '2025-01-12': 9673.16,
  '2025-01-13': 9674.26,
  '2025-01-14': 9675.35,
  '2025-01-15': 9676.45,
  '2025-01-16': 9677.55,
  '2025-01-17': 9678.65,
  '2025-01-18': 9679.74,
  '2025-01-19': 9680.84,
  '2025-01-20': 9681.94,
  '2025-01-21': 9683.03,
  '2025-01-22': 9684.13,
  '2025-01-23': 9685.23,
  '2025-01-24': 9686.32,
  '2025-01-25': 9687.42,
  '2025-01-26': 9688.52,
  '2025-01-27': 9689.61,
  '2025-01-28': 9690.71,
  '2025-01-29': 9691.81,
  '2025-01-30': 9692.90,
  '2025-01-31': 9694.00,
  '2025-02-01': 9695.05,
  '2025-02-02': 9696.10,
  '2025-02-03': 9697.15,
  '2025-02-04': 9698.20,
  '2025-02-05': 9699.25,
  '2025-02-06': 9700.30,
  '2025-02-07': 9701.35,
  '2025-02-08': 9702.40,
  '2025-02-09': 9703.45,
  '2025-02-10': 9704.50,
  '2025-02-11': 9705.55,
  '2025-02-12': 9706.60,
  '2025-02-13': 9707.65,
  '2025-02-14': 9708.70,
  '2025-02-15': 9709.75,
  '2025-02-16': 9710.80,
  '2025-02-17': 9711.85,
  '2025-02-18': 9712.90,
  '2025-02-19': 9713.95,
  '2025-02-20': 9731.00,
  '2025-03-20': 9765.00,
  '2025-04-20': 9802.00,
  '2025-05-20': 9841.00,
  '2025-06-20': 9853.00,
  '2025-07-20': 9860.00,
  '2025-08-20': 9870.00,
  '2025-09-20': 9880.00,
  '2025-10-20': 9890.00,
  '2025-11-20': 9900.00,
  '2025-12-20': 9910.00
};
// ---------------------------------------------------------------------------

function isYMD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s));
}

module.exports = {
  up: async (queryInterface) => {
    // 1) Validate & normalize
    const entries = Object.entries(MANUAL_READINGS)
      .map(([date, val]) => ({ date: String(date), value: Number(val) }))
      .filter(({ date }) => isYMD(date));

    if (!entries.length) return;

    // 2) Ensure the meter exists (avoid FK issues)
    const [meters] = await queryInterface.sequelize.query(
      `SELECT meter_id FROM meter_list WHERE meter_id = :mid`,
      { replacements: { mid: METER_ID } }
    );
    if (!meters.length) return;

    // 3) Skip dates already present
    const dates = entries.map(e => e.date);
    const placeholders = dates.map((_, i) => `:d${i}`).join(',');
    const repl = Object.assign(
      { mid: METER_ID },
      Object.fromEntries(dates.map((d, i) => [`d${i}`, d]))
    );

    const [existing] = await queryInterface.sequelize.query(
      `
      SELECT CONVERT(varchar(10), lastread_date, 23) AS lastread_date
      FROM meter_reading
      WHERE meter_id = :mid AND lastread_date IN (${placeholders})
      `,
      { replacements: repl }
    );
    const existingSet = new Set(existing.map(r => r.lastread_date));

    const toInsert = entries
      .filter(e => !existingSet.has(e.date))
      .sort((a, b) => a.date.localeCompare(b.date));

    if (!toInsert.length) return;

    // 4) Find current max MR-<n>
    const [idRows] = await queryInterface.sequelize.query(
      `SELECT reading_id FROM meter_reading WHERE reading_id LIKE 'MR-%'`
    );
    let maxN = 0;
    for (const r of idRows) {
      const m = String(r.reading_id).match(/^MR-(\d+)$/);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > maxN) maxN = n;
      }
    }

    // 5) Build rows
    const now = new Date().toISOString();
    const rows = toInsert.map(({ date, value }) => {
      maxN += 1;
      const v = Number(value);
      if (!Number.isFinite(v)) {
        throw new Error(`Invalid numeric value for ${date}: ${value}`);
      }
      return {
        reading_id:    `MR-${maxN}`,
        meter_id:      METER_ID,
        reading_value: Math.round(v * 100) / 100, // DECIMAL(30,2)
        lastread_date: date,
        read_by:       'System Admin',
        last_updated:  now,
        updated_by:    'System Admin'
      };
    });

    // 6) Insert (chunked)
    const CHUNK = 1000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      await queryInterface.bulkInsert('meter_reading', slice, {});
    }
  },

  down: async (queryInterface) => {
    const dates = Object.keys(MANUAL_READINGS).filter(isYMD);
    if (!dates.length) return;

    await queryInterface.bulkDelete('meter_reading', {
      meter_id: METER_ID,
      lastread_date: { [queryInterface.sequelize.Op.in]: dates }
    }, {});
  }
};