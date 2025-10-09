'use strict';

module.exports = {
  async up(qi, Sequelize) {
    await qi.createTable('tenant_list', {
      tenant_id:   { type: Sequelize.STRING(30), allowNull: false, primaryKey: true },
      tenant_sn:   { type: Sequelize.STRING(30), allowNull: false, unique: true },
      tenant_name: { type: Sequelize.STRING(50), allowNull: false },
      building_id: { type: Sequelize.STRING(30), allowNull: false },
      // Removed bill_start as per your request
      tenant_status: {
        type: Sequelize.ENUM('active', 'inactive'),
        allowNull: false,
        defaultValue: 'active',
      },
      vat_code: {
        type: Sequelize.STRING(30),
        allowNull: true,  // Nullable as per your requirements
        defaultValue: null,
      },
      wt_code: {
        type: Sequelize.STRING(30),
        allowNull: true,  // Nullable as per your requirements
        defaultValue: null,
      },
      for_penalty: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      last_updated: { type: Sequelize.DATE, allowNull: false },
      updated_by:   { type: Sequelize.STRING(30), allowNull: false },
    });

    // Add index to tenant_sn (already added)
    await qi.addIndex('tenant_list', ['tenant_sn'], { unique: true, name: 'tenant_sn_UNIQUE' });
    await qi.addIndex('tenant_list', ['building_id'], { name: 'tenant_building_id_idx' });

    // FK to the buildings table
    await qi.addConstraint('tenant_list', {
      fields: ['building_id'],
      type: 'foreign key',
      name: 'tenant_building_id',
      references: { table: 'building_list', field: 'building_id' },
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    });

    // Optional FK for vat_code (from vat_codes table)
    await qi.addConstraint('tenant_list', {
      fields: ['vat_code'],
      type: 'foreign key',
      name: 'tenant_vat_code',
      references: { table: 'vat_codes', field: 'vat_code' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });

    // Optional FK for wt_code (from wt_codes table)
    await qi.addConstraint('tenant_list', {
      fields: ['wt_code'],
      type: 'foreign key',
      name: 'tenant_wt_code',
      references: { table: 'wt_codes', field: 'wt_code' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });
  },

  async down(qi) {
    // Remove constraints and indexes
    await qi.removeConstraint('tenant_list', 'tenant_building_id');
    await qi.removeConstraint('tenant_list', 'tenant_vat_code');
    await qi.removeConstraint('tenant_list', 'tenant_wt_code');
    await qi.removeIndex('tenant_list', 'tenant_building_id_idx');
    await qi.removeIndex('tenant_list', 'tenant_sn_UNIQUE');
    await qi.dropTable('tenant_list');
    try { await qi.sequelize.query('DROP TYPE IF EXISTS "enum_tenant_list_tenant_status";'); } catch {}
  }
};
