const { DataTypes } = require('sequelize');
const sequelize = require('./index');

const Reading = sequelize.define('Reading', {
  reading_id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  meter_id: DataTypes.STRING,
  reading_value: {
    type: DataTypes.DECIMAL(30, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  read_by: DataTypes.STRING,
  lastread_date: DataTypes.DATE,
  last_updated: {
    type: DataTypes.DATE,
    allowNull: false
  },
  updated_by: DataTypes.STRING
}, {
  tableName: 'meter_reading',
  timestamps: false,
});

module.exports = Reading;
