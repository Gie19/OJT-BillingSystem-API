'use strict';

module.exports = {
  async up(qi, Sequelize) {
    await qi.createTable('building_list', {
      building_id: { type: Sequelize.STRING(30), allowNull: false, primaryKey: true },
      building_name: { type: Sequelize.STRING(30), allowNull: false }, // matches model:contentReference[oaicite:8]{index=8}
      last_updated: { type: Sequelize.DATE, allowNull: false },
      updated_by: { type: Sequelize.STRING(30), allowNull: false },
    });
  },
  async down(qi) {
    await qi.dropTable('building_list');
  }
};
