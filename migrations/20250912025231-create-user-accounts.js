'use strict';

module.exports = {
  async up(qi, Sequelize) {
    await qi.createTable('user_accounts', {
      user_id:       { type: Sequelize.STRING(30), allowNull: false, primaryKey: true },
      user_password: { type: Sequelize.STRING(255), allowNull: false },
      user_fullname: { type: Sequelize.STRING(50), allowNull: false },
      user_level:    { type: Sequelize.ENUM('admin','operator','biller'), allowNull: false },
      building_id:   { type: Sequelize.STRING(30), allowNull: true, defaultValue: null },
      utility_role:  { type: Sequelize.JSON, allowNull: true, defaultValue: null },
    });

    await qi.addIndex('user_accounts', ['building_id'], { name: 'user_building_id_idx' });

    await qi.addConstraint('user_accounts', {
      fields: ['building_id'],
      type: 'foreign key',
      name: 'user_building_id',
      references: { table: 'building_list', field: 'building_id' },
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    });
  },
  async down(qi) {
    await qi.removeConstraint('user_accounts', 'user_building_id');
    await qi.removeIndex('user_accounts', 'user_building_id_idx');
    await qi.dropTable('user_accounts');
    try { await qi.sequelize.query('DROP TYPE IF EXISTS "enum_user_accounts_user_level";'); } catch {}
  }
};
