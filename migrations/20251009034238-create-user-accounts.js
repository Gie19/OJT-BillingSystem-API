'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('user_accounts', {
      user_id:       { type: Sequelize.STRING(30), allowNull: false, primaryKey: true },
      user_password: { type: Sequelize.STRING(255), allowNull: false },
      user_fullname: { type: Sequelize.STRING(50), allowNull: false },

      // ENUM is emulated as a CHECK constraint by Sequelize on MSSQL
      user_level:    { type: Sequelize.ENUM('admin', 'operator', 'biller'), allowNull: false },

      // nullable for admins
      building_id:   { type: Sequelize.STRING(30), allowNull: true, defaultValue: null },

      // Store small JSON as a string; model getter/setter (de)serializes
      utility_role:  { type: Sequelize.STRING(1000), allowNull: true, defaultValue: null },
    });

    await queryInterface.addIndex('user_accounts', ['building_id'], {
      name: 'user_building_id_idx'
    });

    await queryInterface.addConstraint('user_accounts', {
      fields: ['building_id'],
      type: 'foreign key',
      name: 'user_building_id',
      references: { table: 'building_list', field: 'building_id' },
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeConstraint('user_accounts', 'user_building_id');
    await queryInterface.removeIndex('user_accounts', 'user_building_id_idx');
    await queryInterface.dropTable('user_accounts');
    // ENUM cleanup (harmless on MSSQL; guarded try/catch)
    try { await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_user_accounts_user_level";'); } catch {}
  }
};
