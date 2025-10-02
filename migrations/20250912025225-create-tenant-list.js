'use strict';

module.exports = {
  async up(qi, Sequelize) {
    await qi.createTable('tenant_list', {
      tenant_id:   { type: Sequelize.STRING(30), allowNull: false, primaryKey: true },
      tenant_sn:   { type: Sequelize.STRING(30), allowNull: false, unique: true },
      tenant_name: { type: Sequelize.STRING(50), allowNull: false },
      building_id: { type: Sequelize.STRING(30), allowNull: false },
      bill_start:  { type: Sequelize.DATEONLY, allowNull: false },
      tenant_status: {
        type: Sequelize.ENUM('active','inactive'),
        allowNull: false,
        defaultValue: 'active'
      },
      last_updated:{ type: Sequelize.DATE, allowNull: false },
      updated_by:  { type: Sequelize.STRING(30), allowNull: false },
    });

    await qi.addIndex('tenant_list', ['tenant_sn'], { unique: true, name: 'tenant_sn_UNIQUE' });
    await qi.addIndex('tenant_list', ['building_id'], { name: 'tenant_building_id_idx' });

    await qi.addConstraint('tenant_list', {
      fields: ['building_id'],
      type: 'foreign key',
      name: 'tenant_building_id',
      references: { table: 'building_list', field: 'building_id' },
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    });
  },
  async down(qi) {
    await qi.removeConstraint('tenant_list', 'tenant_building_id');
    await qi.removeIndex('tenant_list', 'tenant_building_id_idx');
    await qi.removeIndex('tenant_list', 'tenant_sn_UNIQUE');
    await qi.dropTable('tenant_list');
    try { await qi.sequelize.query('DROP TYPE IF EXISTS "enum_tenant_list_tenant_status";'); } catch {}
  }
};
