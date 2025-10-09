'use strict';

module.exports = {
  async up(qi, Sequelize) {
    // Create table
    await qi.createTable('tenant_list', {
      tenant_id:     { type: Sequelize.STRING(30), allowNull: false, primaryKey: true },
      tenant_sn:     { type: Sequelize.STRING(30), allowNull: false, unique: true },
      tenant_name:   { type: Sequelize.STRING(50), allowNull: false },
      building_id:   { type: Sequelize.STRING(30), allowNull: false },

      // New fields per spec
      vat_code:      { type: Sequelize.STRING(30), allowNull: true, defaultValue: null },
      wt_code:       { type: Sequelize.STRING(30), allowNull: true, defaultValue: null },
      for_penalty:   { type: Sequelize.BOOLEAN,   allowNull: false, defaultValue: false },

      tenant_status: {
        type: Sequelize.ENUM('active', 'inactive'),
        allowNull: false,
        defaultValue: 'active',
      },

      // Audit
      last_updated:  { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('GETDATE') },
      updated_by:    { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'System Admin' },
    });

    // Indexes
    await qi.addIndex('tenant_list', ['tenant_sn'],   { unique: true, name: 'ux_tenant_sn' });
    await qi.addIndex('tenant_list', ['building_id'], { name: 'ix_tenant_building_id' });
    await qi.addIndex('tenant_list', ['for_penalty'], { name: 'ix_tenant_for_penalty' });
    await qi.addIndex('tenant_list', ['vat_code'],    { name: 'ix_tenant_vat_code' });
    await qi.addIndex('tenant_list', ['wt_code'],     { name: 'ix_tenant_wt_code' });

    // FKs
    await qi.addConstraint('tenant_list', {
      fields: ['building_id'],
      type: 'foreign key',
      name: 'fk_tenant_building_id',
      references: { table: 'building_list', field: 'building_id' },
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    });

    // Optional but recommended (since codes are shared catalogs)
    await qi.addConstraint('tenant_list', {
      fields: ['vat_code'],
      type: 'foreign key',
      name: 'fk_tenant_vat_code',
      references: { table: 'vat_codes', field: 'vat_code' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });

    await qi.addConstraint('tenant_list', {
      fields: ['wt_code'],
      type: 'foreign key',
      name: 'fk_tenant_wt_code',
      references: { table: 'wt_codes', field: 'wt_code' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });
  },

  // Fresh DB: nothing to clean up
  async down() { /* intentionally empty */ },
};
