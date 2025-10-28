'use strict';

module.exports = {
  async up (queryInterface) {
    // Five tenants to create — IDs use TNT-<n> to match the route
    const desired = [
      { tenant_id: 'TNT-1', tenant_sn: 'TNT0003238', tenant_name: 'JOLECO RESOURCES INC./ VICTORIA UGTO'},
      { tenant_id: 'TNT-2', tenant_sn: 'TNT0003006', tenant_name: 'THE DIY (DO-IT-YOURSELF) SHOP, CORP.'},
      { tenant_id: 'TNT-3', tenant_sn: 'TNT0002981', tenant_name: 'MLMCHOW CORP. (CHOWKING)' },
      { tenant_id: 'TNT-4', tenant_sn: 'TNT0003241', tenant_name: 'TRIPLE SJ SUPERSTORE, INC.'},
      { tenant_id: 'TNT-5', tenant_sn: 'TNT0003231', tenant_name: 'ANTIGUA MANDARIN CORP. (WAREHOUSE)'},
    ];

    if (!desired.length) return;

    // Skip any tenant_sn that already exists (idempotent by serial number)
    const snsSql = desired.map(t => `'${String(t.tenant_sn).replace(/'/g, "''")}'`).join(',');
    const [existingRows] = await queryInterface.sequelize.query(
      `SELECT tenant_sn FROM tenant_list WHERE tenant_sn IN (${snsSql})`
    );
    const existing = new Set((existingRows || []).map(r => r.tenant_sn));
    const toInsert = desired.filter(t => !existing.has(t.tenant_sn));
    if (!toInsert.length) return;

    // Compute next available TNT-<n> to avoid tenant_id collisions
    const [maxNumRows] = await queryInterface.sequelize.query(`
      SELECT MAX(CAST(SUBSTRING(tenant_id, 5, 50) AS INT)) AS maxNum
      FROM tenant_list
      WHERE tenant_id LIKE 'TNT-%'
    `);
    let maxNum = (Array.isArray(maxNumRows) && maxNumRows[0] && maxNumRows[0].maxNum) || 0;

    const [takenIdsRows] = await queryInterface.sequelize.query(
      `SELECT tenant_id FROM tenant_list WHERE tenant_id LIKE 'TNT-%'`
    );
    const takenIds = new Set((takenIdsRows || []).map(r => r.tenant_id));

    // Apply required/constant fields and finalize rows
    for (const row of toInsert) {
      if (takenIds.has(row.tenant_id)) {
        maxNum += 1;
        row.tenant_id = `TNT-${maxNum}`; // match route’s ID scheme
      }
      row.building_id   = 'BLDG-1';
      row.vat_code      = 'S-PH';
      row.wt_code       = 'WC158';
      row.for_penalty   = true;
      row.tenant_status = 'active';
      row.last_updated  = new Date();
      row.updated_by    = 'System Admin';
    }

    await queryInterface.bulkInsert('tenant_list', toInsert, {});
  },

  async down (queryInterface) {
    // Delete exactly what was inserted above
    await queryInterface.bulkDelete('tenant_list', {
      tenant_sn: ['TNT0003238', 'TNT0003006', 'TNT0002981', 'TNT0003241', 'TNT0003231']
    }, {});
  }
};
