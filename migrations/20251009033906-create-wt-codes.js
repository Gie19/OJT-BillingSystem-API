'use strict';

module.exports = {
  async up(qi, Sequelize) {
    await qi.createTable('wt_codes', {
      wt_id:          { type: Sequelize.STRING(30), allowNull: false, primaryKey: true },
      wt_code:        { type: Sequelize.STRING(30), allowNull: false },
      wt_description: { type: Sequelize.STRING(250), allowNull: false, defaultValue: 'Insert Description' },
      e_wt:           { type: Sequelize.DECIMAL(10,2), allowNull: false, defaultValue: 1.00 },
      w_wt:           { type: Sequelize.DECIMAL(10,2), allowNull: false, defaultValue: 1.00 },
      l_wt:           { type: Sequelize.DECIMAL(10,2), allowNull: false, defaultValue: 1.00 },
      last_updated:   { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('GETDATE') },
      updated_by:     { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'System Admin' },
    });

    await qi.addIndex('wt_codes', { fields: ['wt_code'], unique: true, name: 'ux_wt_codes_wt_code' });
  },

  async down(qi) {
    await qi.dropTable('wt_codes');
  }
};
