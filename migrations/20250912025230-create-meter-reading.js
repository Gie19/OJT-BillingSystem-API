'use strict';

module.exports = {
  async up(qi, Sequelize) {
    await qi.createTable('meter_reading', {
      reading_id:   { type: Sequelize.STRING(30), allowNull: false, primaryKey: true },
      meter_id:     { type: Sequelize.STRING(30), allowNull: false },
      reading_value:{ type: Sequelize.DECIMAL(30,2), allowNull: false, defaultValue: 0.00 }, // removed .UNSIGNED
      read_by:      { type: Sequelize.STRING(30), allowNull: false },
      lastread_date:{ type: Sequelize.DATEONLY, allowNull: false },
      last_updated: { type: Sequelize.DATE, allowNull: false },
      updated_by:   { type: Sequelize.STRING(30), allowNull: false },
    });

    await qi.addConstraint('meter_reading', {
      type: 'unique',
      name: 'lastread_date_UNIQUE',
      fields: ['meter_id','lastread_date']
    });

    await qi.addConstraint('meter_reading', {
      fields: ['meter_id'],
      type: 'foreign key',
      name: 'reading_meter_id',
      references: { table: 'meter_list', field: 'meter_id' },
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    });
  },
  async down(qi) {
    await qi.removeConstraint('meter_reading', 'reading_meter_id');
    await qi.removeConstraint('meter_reading', 'lastread_date_UNIQUE');
    await qi.dropTable('meter_reading');
  }
};
