const { DataTypes } = require('sequelize');
const sequelize = require('./index');

const Meter = sequelize.define('Meter', {
  meter_id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  meter_type: {
    type: DataTypes.ENUM('electric', 'water', 'lpg'),
    allowNull: false
  },
  meter_sn: {
    type: DataTypes.STRING(30),
    allowNull: false,
    unique: true
  },
  meter_mult: {
    type: DataTypes.DECIMAL(10, 2).UNSIGNED,
    allowNull: false
  },
  meter_status: {
    type: DataTypes.ENUM('active', 'inactive'),
    allowNull: false,
    defaultValue: 'inactive'
  },
  stall_id: {
    type: DataTypes.STRING(30),
    allowNull: false
  },
  last_updated: {
    type: DataTypes.DATE,
    allowNull: false
  },
  updated_by: {
    type: DataTypes.STRING(30),
    allowNull: false
  }
}, {
  tableName: 'meter_list',
  timestamps: false,
});

module.exports = Meter;
