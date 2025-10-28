'use strict';

/**
 * Seeds: vat_codes
 * - Matches your VAT route expectations:
 *   - tax_id "VAT-<n>"
 *   - vat_code unique
 *   - e_vat, w_vat, l_vat are 0–100
 *   - last_updated / updated_by present
 * - MSSQL-friendly & idempotent (by vat_code)
 */

module.exports = {
  async up (queryInterface /*, Sequelize */) {
    const desired = [
      {
        tax_id: 'VAT-1',
        vat_code: 'S-PH',
        vat_description: 'Vatable Sales of Goods and Services/Receipt of Goods',
        e_vat: 12.00, w_vat: 12.00, l_vat: 12.00,
        last_updated: new Date(),
        updated_by: 'System Admin',
      },
      {
        tax_id: 'VAT-2',
        vat_code: 'Z-PH',
        vat_description: 'Zero Rated Sales/Receipts/Purchases',
        e_vat: 0.00, w_vat: 0.00, l_vat: 0.00,
        last_updated: new Date(),
        updated_by: 'System Admin',
      },
      {
        tax_id: 'VAT-3',
        vat_code: 'EX-PH',
        vat_description: 'Exempt Sales/Receipts/Purchases Not Qualified for Input Tax',
        e_vat: 0.00, w_vat: 0.00, l_vat: 0.00,
        last_updated: new Date(),
        updated_by: 'System Admin',
      }
    ];

    if (!desired.length) return;

    // Skip existing by vat_code
    const codesSql = desired.map(v => `'${String(v.vat_code).replace(/'/g, "''")}'`).join(',');
    const [existingRows] = await queryInterface.sequelize.query(
      `SELECT vat_code FROM vat_codes WHERE vat_code IN (${codesSql})`
    );
    const existing = new Set((existingRows || []).map(r => r.vat_code));
    const toInsert = desired.filter(v => !existing.has(v.vat_code));
    if (!toInsert.length) return;

    // Avoid tax_id collisions; assign next VAT-<n> if needed
    const [maxNumRows] = await queryInterface.sequelize.query(`
      SELECT MAX(CAST(SUBSTRING(tax_id, 5, 50) AS INT)) AS maxNum
      FROM vat_codes
      WHERE tax_id LIKE 'VAT-%'
    `);
    let maxNum = (Array.isArray(maxNumRows) && maxNumRows[0] && maxNumRows[0].maxNum) || 0;

    const [takenIdsRows] = await queryInterface.sequelize.query(
      `SELECT tax_id FROM vat_codes WHERE tax_id LIKE 'VAT-%'`
    );
    const takenIds = new Set((takenIdsRows || []).map(r => r.tax_id));

    for (const row of toInsert) {
      if (takenIds.has(row.tax_id)) {
        maxNum += 1;
        row.tax_id = `VAT-${maxNum}`;
      }
    }

    await queryInterface.bulkInsert('vat_codes', toInsert, {});
  },

  async down (queryInterface /*, Sequelize */) {
    // Remove exactly the codes we inserted
    await queryInterface.bulkDelete('vat_codes', {
      vat_code: ['S-PH', 'Z-PH', 'EX-PH']
    }, {});
  }
};
