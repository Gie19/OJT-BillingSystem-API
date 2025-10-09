'use strict';

module.exports = {
  async up(qi, Sequelize) {
    await qi.createTable('stall_list', {
      stall_id:     { type: Sequelize.STRING(30), allowNull: false, primaryKey: true },
      stall_sn:     { type: Sequelize.STRING(30), allowNull: false, unique: true },
      tenant_id:    { type: Sequelize.STRING(30), allowNull: true },
      building_id:  { type: Sequelize.STRING(30), allowNull: false },
      stall_status: {
        type: Sequelize.ENUM('occupied','available','under maintenance'),
        allowNull: false,
        defaultValue: 'available'
      },
      last_updated: { type: Sequelize.DATE, allowNull: false },
      updated_by:   { type: Sequelize.STRING(30), allowNull: false },
    });

    await qi.addIndex('stall_list', ['stall_sn'], { unique: true, name: 'stall_sn_UNIQUE' });
    await qi.addIndex('stall_list', ['tenant_id'], { name: 'stall_tenant_id_idx' });
    await qi.addIndex('stall_list', ['building_id'], { name: 'stall_building_id_idx' });

    await qi.addConstraint('stall_list', {
      fields: ['building_id'],
      type: 'foreign key',
      name: 'stall_building_id',
      references: { table: 'building_list', field: 'building_id' },
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    });

    await qi.addConstraint('stall_list', {
      fields: ['tenant_id'],
      type: 'foreign key',
      name: 'stall_tenant_id',
      references: { table: 'tenant_list', field: 'tenant_id' },
      onDelete: 'SET NULL',
      onUpdate: 'NO ACTION',
    });
  },
  async down(qi) {
    await qi.removeConstraint('stall_list', 'stall_tenant_id');
    await qi.removeConstraint('stall_list', 'stall_building_id');
    await qi.removeIndex('stall_list', 'stall_building_id_idx');
    await qi.removeIndex('stall_list', 'stall_tenant_id_idx');
    await qi.removeIndex('stall_list', 'stall_sn_UNIQUE');
    await qi.dropTable('stall_list');
    try { await qi.sequelize.query('DROP TYPE IF EXISTS "enum_stall_list_stall_status";'); } catch {}
  }
};
