'use strict';

module.exports = {
  async up (queryInterface) {
    // 5 stalls to create
    const desired = [
      { stall_id: 'STL-1', stall_sn: 'UGF-102AF' },
      { stall_id: 'STL-2', stall_sn: 'UGF-145' },
      { stall_id: 'STL-3', stall_sn: 'UGF-101AF' },
      { stall_id: 'STL-4', stall_sn: 'UGF 143-144' },
      { stall_id: 'STL-5', stall_sn: 'UGF WH 2' },
    ];

    if (!desired.length) return;

    // Skip any stall_sn that already exists (unique)
    const snsSql = desired.map(s => `'${String(s.stall_sn).replace(/'/g, "''")}'`).join(',');
    const [existingRows] = await queryInterface.sequelize.query(
      `SELECT stall_sn FROM stall_list WHERE stall_sn IN (${snsSql})`
    );
    const existing = new Set((existingRows || []).map(r => r.stall_sn));
    const toInsert = desired.filter(s => !existing.has(s.stall_sn));
    if (!toInsert.length) return;

    // Compute next available STL-<n> to avoid stall_id collisions
    const [maxNumRows] = await queryInterface.sequelize.query(`
      SELECT MAX(CAST(SUBSTRING(stall_id, 5, 50) AS INT)) AS maxNum
      FROM stall_list
      WHERE stall_id LIKE 'STL-%'
    `);
    let maxNum = (Array.isArray(maxNumRows) && maxNumRows[0] && maxNumRows[0].maxNum) || 0;

    const [takenIdsRows] = await queryInterface.sequelize.query(
      `SELECT stall_id FROM stall_list WHERE stall_id LIKE 'STL-%'`
    );
    const takenIds = new Set((takenIdsRows || []).map(r => r.stall_id));

    // Apply required fields and defaults
    for (const row of toInsert) {
      if (takenIds.has(row.stall_id)) {
        maxNum += 1;
        row.stall_id = `STL-${maxNum}`; // same pattern your route uses
      }
      row.tenant_id    = null;               // available stalls have no tenant
      row.building_id  = 'BLDG-1';
      row.stall_status = 'available';        // valid per model enum
      row.last_updated = new Date();
      row.updated_by   = 'System Admin';
    }

    await queryInterface.bulkInsert('stall_list', toInsert, {});
  },

  async down (queryInterface) {
    // Delete exactly the 5 stalls by their serial numbers
    await queryInterface.bulkDelete('stall_list', {
      stall_sn: ['UGF-102AF', 'UGF-145', 'UGF-101AF', 'UGF 143-144', 'UGF WH 2']
    }, {});
  }
};
