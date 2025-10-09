'use strict';

module.exports = {
  async up(qi, Sequelize) {
    const { Op } = Sequelize;

    // 1) Create vat_codes table
    await qi.createTable('vat_codes', {
      tax_id:        { type: Sequelize.STRING(30), allowNull: false, primaryKey: true },
      vat_code:      { type: Sequelize.STRING(30), allowNull: false },      // unique index added below
      vat_description:{ type: Sequelize.STRING(100), allowNull: false, defaultValue: 'Zero Rated' },

      // Percent points (e.g., 12.00 = 12%)
      e_vat:         { type: Sequelize.DECIMAL(10,2), allowNull: false, defaultValue: 0.00 },
      w_vat:         { type: Sequelize.DECIMAL(10,2), allowNull: false, defaultValue: 0.00 },
      l_vat:         { type: Sequelize.DECIMAL(10,2), allowNull: false, defaultValue: 0.00 },

      // Audit fields (MSSQL-safe defaults)
      last_updated:  { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('GETDATE') },
      updated_by:    { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'System Admin' },
    });

    // 2) Enforce uniqueness and lookups
    await qi.addIndex('vat_codes', { fields: ['vat_code'], unique: true, name: 'ux_vat_codes_vat_code' });
    await qi.addIndex('vat_codes', { fields: ['vat_description'], name: 'ix_vat_codes_desc' });

    // 3) Optional CHECK constraints (0..100 bounds) — works on MSSQL/Postgres
    await qi.addConstraint('vat_codes', {
      fields: ['e_vat'],
      type: 'check',
      name: 'ck_vat_codes_e_vat_0_100',
      where: { e_vat: { [Op.between]: [0, 100] } },
    });
    await qi.addConstraint('vat_codes', {
      fields: ['w_vat'],
      type: 'check',
      name: 'ck_vat_codes_w_vat_0_100',
      where: { w_vat: { [Op.between]: [0, 100] } },
    });
    await qi.addConstraint('vat_codes', {
      fields: ['l_vat'],
      type: 'check',
      name: 'ck_vat_codes_l_vat_0_100',
      where: { l_vat: { [Op.between]: [0, 100] } },
    });
  },

  async down(qi /*, Sequelize */) {
    // This will be empty because you're starting fresh with a clean database
  }
};
