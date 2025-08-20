// models/Building.js
const { DataTypes } = require('sequelize');
const sequelize = require('./index');

const Building = sequelize.define('Building', {
  building_id: {
    type: DataTypes.STRING,
    primaryKey: true,
  },
  // VARCHAR(30) NOT NULL in DB
  building_name: {
    type: DataTypes.STRING(30),
    allowNull: false,
  },
  // removed: rate_id  <-- not in the new schema

  // DATETIME NOT NULL in DB
  last_updated: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  // VARCHAR(30) NOT NULL in DB
  updated_by: {
    type: DataTypes.STRING(30),
    allowNull: false,
  },
}, {
  tableName: 'building_list',
  timestamps: false,
});

module.exports = Building;
