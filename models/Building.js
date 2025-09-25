// models/Building.js
const { DataTypes } = require('sequelize');
const sequelize = require('./index');

const Building = sequelize.define('Building', {
  building_id:   { type: DataTypes.STRING, primaryKey: true },
  building_name: { type: DataTypes.STRING(30), allowNull: false },

  // NEW: building-level base rates
  erate_perKwH:  { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0.00 },
  emin_con:      { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0.00 },
  wrate_perCbM:  { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0.00 },
  wmin_con:      { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0.00 },
  lrate_perKg:   { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0.00 },

  last_updated:  { type: DataTypes.DATE, allowNull: false },
  updated_by:    { type: DataTypes.STRING(30), allowNull: false },
}, {
  tableName: 'building_list',
  timestamps: false,
});

module.exports = Building;
