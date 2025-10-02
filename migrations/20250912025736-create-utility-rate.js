'use strict';

module.exports = {
  async up(qi, Sequelize) {
    await qi.createTable('utility_rate', {
      rate_id:       { type: Sequelize.STRING(30), allowNull: false, primaryKey: true },
      tenant_id:     { type: Sequelize.STRING(30), allowNull: false, unique: true }, // one row per tenant

      // Tenant-specific items that remain (MSSQL-safe: removed .UNSIGNED)
      e_vat:         { type: Sequelize.DECIMAL(10,2), allowNull: false, defaultValue: 0.00 },
      wnet_vat:      { type: Sequelize.DECIMAL(10,2), allowNull: false, defaultValue: 0.00 },
      w_vat:         { type: Sequelize.DECIMAL(10,2), allowNull: false, defaultValue: 0.00 },

      last_updated:  { type: Sequelize.DATE, allowNull: false },
      updated_by:    { type: Sequelize.STRING(30), allowNull: false },
    });

    await qi.addIndex('utility_rate', ['tenant_id'], { unique: true, name: 'tenant_id_UNIQUE' });
    await qi.addIndex('utility_rate', ['tenant_id'], { name: 'rate_tenant_id_idx' });

    await qi.addConstraint('utility_rate', {
      fields: ['tenant_id'],
      type: 'foreign key',
      name: 'rate_tenant_id',
      references: { table: 'tenant_list', field: 'tenant_id' },
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    });
  },

  async down(qi) {
    await qi.removeConstraint('utility_rate', 'rate_tenant_id');
    await qi.removeIndex('utility_rate', 'rate_tenant_id_idx');
    await qi.removeIndex('utility_rate', 'tenant_id_UNIQUE');
    await qi.dropTable('utility_rate');
  }
};
