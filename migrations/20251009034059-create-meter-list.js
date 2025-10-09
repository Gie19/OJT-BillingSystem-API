'use strict';

module.exports = {
  async up(qi, Sequelize) {
    await qi.createTable('meter_list', {
      meter_id:     { type: Sequelize.STRING(30), allowNull: false, primaryKey: true },
      meter_type:   { type: Sequelize.ENUM('electric','water','lpg'), allowNull: false },
      meter_sn:     { type: Sequelize.STRING(30), allowNull: false, unique: true },
      meter_mult:   { type: Sequelize.DECIMAL(10,2), allowNull: false }, // removed .UNSIGNED
      meter_status: {
        type: Sequelize.ENUM('active','inactive'),
        allowNull: false,
        defaultValue: 'inactive'
      },
      stall_id:     { type: Sequelize.STRING(30), allowNull: false },
      last_updated: { type: Sequelize.DATE, allowNull: false },
      updated_by:   { type: Sequelize.STRING(30), allowNull: false },
    });

    await qi.addIndex('meter_list', ['meter_sn'], { unique: true, name: 'meter_sn_UNIQUE' });
    await qi.addIndex('meter_list', ['stall_id'], { name: 'stall_id_idx' });

    await qi.addConstraint('meter_list', {
      fields: ['stall_id'],
      type: 'foreign key',
      name: 'stall_id',
      references: { table: 'stall_list', field: 'stall_id' },
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    });
  },
  async down(qi) {
    await qi.removeConstraint('meter_list', 'stall_id');
    await qi.removeIndex('meter_list', 'stall_id_idx');
    await qi.removeIndex('meter_list', 'meter_sn_UNIQUE');
    await qi.dropTable('meter_list');
    try { await qi.sequelize.query('DROP TYPE IF EXISTS "enum_meter_list_meter_type";'); } catch {}
    try { await qi.sequelize.query('DROP TYPE IF EXISTS "enum_meter_list_meter_status";'); } catch {}
  }
};
