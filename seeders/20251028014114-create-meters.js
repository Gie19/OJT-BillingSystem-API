'use strict';

module.exports = {
  async up (queryInterface) {
    const desired = [
      {
        meter_id:    'MTR-1',
        meter_type:  'electric',
        meter_sn:    'WDC-E-2362324',
        meter_mult:  80.00,
        meter_status:'active',
        stall_id:    'STL-1',
        last_updated:new Date(),
        updated_by:  'System Admin',
      },
      {
        meter_id:    'MTR-2',
        meter_type:  'electric', // fixed
        meter_sn:    'WDC-E-362329',
        meter_mult:  80.00,
        meter_status:'active',
        stall_id:    'STL-2',
        last_updated:new Date(),
        updated_by:  'System Admin',
      },
      {
        meter_id:    'MTR-3',
        meter_type:  'electric',
        meter_sn:    'WDC-E-2364100',
        meter_mult:  60.00,
        meter_status:'active',
        stall_id:    'STL-3',
        last_updated:new Date(),
        updated_by:  'System Admin',
      },
      {
        meter_id:    'MTR-4',
        meter_type:  'electric', 
        meter_sn:    'WDC-E-2362327',
        meter_mult:  240.00,
        meter_status:'active',
        stall_id:    'STL-4',
        last_updated:new Date(),
        updated_by:  'System Admin',
      },
      {
        meter_id:    'MTR-5',
        meter_type:  'electric',
        meter_sn:    'WDC-E-809990',
        meter_mult:  1.00,
        meter_status:'active',
        stall_id:    'STL-5',
        last_updated:new Date(),
        updated_by:  'System Admin',
      },
    ];

    if (!desired.length) return;

    // Idempotency by meter_sn
    const snsSql = desired.map(m => `'${String(m.meter_sn).replace(/'/g, "''")}'`).join(',');
    const [existingRows] = await queryInterface.sequelize.query(
      `SELECT meter_sn FROM meter_list WHERE meter_sn IN (${snsSql})`
    );
    const existing = new Set((existingRows || []).map(r => r.meter_sn));
    const toInsert = desired.filter(m => !existing.has(m.meter_sn));
    if (!toInsert.length) return;

    // Next available MTR-<n>
    const [maxNumRows] = await queryInterface.sequelize.query(`
      SELECT MAX(CAST(SUBSTRING(meter_id, 5, 50) AS INT)) AS maxNum
      FROM meter_list
      WHERE meter_id LIKE 'MTR-%'
    `);
    let maxNum = (Array.isArray(maxNumRows) && maxNumRows[0] && maxNumRows[0].maxNum) || 0;

    const [takenIdsRows] = await queryInterface.sequelize.query(
      `SELECT meter_id FROM meter_list WHERE meter_id LIKE 'MTR-%'`
    );
    const takenIds = new Set((takenIdsRows || []).map(r => r.meter_id));

    const ALLOWED_TYPES  = new Set(['electric','water','lpg']);
    const ALLOWED_STATUS = new Set(['active','inactive']);

    for (const row of toInsert) {
      if (takenIds.has(row.meter_id)) {
        maxNum += 1;
        row.meter_id = `MTR-${maxNum}`;
      }
      if (!ALLOWED_TYPES.has(String(row.meter_type).toLowerCase())) {
        throw new Error(`Invalid meter_type for ${row.meter_sn}. Use electric|water|lpg`);
      }
      if (!ALLOWED_STATUS.has(String(row.meter_status).toLowerCase())) {
        throw new Error(`Invalid meter_status for ${row.meter_sn}. Use active|inactive`);
      }
      const mult = Number(row.meter_mult);
      if (!Number.isFinite(mult) || mult < 0) {
        throw new Error(`meter_mult must be a non-negative number for ${row.meter_sn}`);
      }
      row.meter_mult = Math.round(mult * 100) / 100;
      row.last_updated = row.last_updated || new Date();
      row.updated_by   = row.updated_by   || 'System Admin';
    }

    await queryInterface.bulkInsert('meter_list', toInsert, {});
  },

  async down (queryInterface) {
    // Delete exactly what was inserted above
    await queryInterface.bulkDelete('meter_list', {
      meter_sn: ['WDC-E-2362324', 'WDC-E-362329', 'WDC-E-2364100', 'WDC-E-2362327', 'WDC-E-809990']
    }, {});
  }
};
