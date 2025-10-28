'use strict';

module.exports = {
  async up (queryInterface) {
    const desired = [
      {
        wt_id: 'WT-1',
        wt_code: 'WC158',
        wt_description: 'EWT – top 10,000 private corps, purchases of goods (creditable)',
        e_wt: 1.00, w_wt: 1.00, l_wt: 1.00,
        last_updated: new Date(),
        updated_by: 'System Admin',
      },
      {
        wt_id: 'WT-2',
        wt_code: 'WI158',
        wt_description: 'EWT – top 10,000 private corps, purchases of goods (income)',
        e_wt: 1.00, w_wt: 1.00, l_wt: 1.00,
        last_updated: new Date(),
        updated_by: 'System Admin',
      },
      {
        wt_id: 'WT-3',
        wt_code: 'WC160',
        wt_description: 'EWT – top 10,000 private corps, purchases of services (creditable)',
        e_wt: 2.00, w_wt: 2.00, l_wt: 2.00,
        last_updated: new Date(),
        updated_by: 'System Admin',
      },
      {
        wt_id: 'WT-4',
        wt_code: 'WI160',
        wt_description: 'EWT – top 10,000 private corps, purchases of services (income)',
        e_wt: 2.00, w_wt: 2.00, l_wt: 2.00,
        last_updated: new Date(),
        updated_by: 'System Admin',
      },
    ];

    if (!desired.length) return;

    // Skip existing by wt_code
    const codesSql = desired.map(v => `'${String(v.wt_code).replace(/'/g, "''")}'`).join(',');
    const [existingRows] = await queryInterface.sequelize.query(
      `SELECT wt_code FROM wt_codes WHERE wt_code IN (${codesSql})`
    );
    const existing = new Set((existingRows || []).map(r => r.wt_code));
    const toInsert = desired.filter(v => !existing.has(v.wt_code));
    if (!toInsert.length) return;

    // Avoid wt_id collisions; assign next WT-<n> and normalize numbers
    const [maxNumRows] = await queryInterface.sequelize.query(`
      SELECT MAX(CAST(SUBSTRING(wt_id, 4, 50) AS INT)) AS maxNum
      FROM wt_codes
      WHERE wt_id LIKE 'WT-%'
    `);
    let maxNum = (Array.isArray(maxNumRows) && maxNumRows[0] && maxNumRows[0].maxNum) || 0;

    const [takenIdsRows] = await queryInterface.sequelize.query(
      `SELECT wt_id FROM wt_codes WHERE wt_id LIKE 'WT-%'`
    );
    const takenIds = new Set((takenIdsRows || []).map(r => r.wt_id));

    for (const row of toInsert) {
      if (takenIds.has(row.wt_id)) {
        maxNum += 1;
        row.wt_id = `WT-${maxNum}`;
      }
      row.e_wt = Math.round(Number(row.e_wt) * 100) / 100;
      row.w_wt = Math.round(Number(row.w_wt) * 100) / 100;
      row.l_wt = Math.round(Number(row.l_wt) * 100) / 100;
    }

    await queryInterface.bulkInsert('wt_codes', toInsert, {});
  },

  async down (queryInterface) {
    await queryInterface.bulkDelete('wt_codes', {
      wt_code: ['WC158', 'WI158', 'WC160', 'WI160']
    }, {});
  }
};
