const { DataTypes } = require('sequelize');
const sequelize = require('./index');

const Reading = sequelize.define('Reading', {
  reading_id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  meter_id: DataTypes.STRING, // Foreign key to meter_list
  prev_reading: {
    type: DataTypes.DECIMAL(30, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  curr_reading: {
    type: DataTypes.DECIMAL(30, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  read_by: DataTypes.STRING,
  lastread_date: DataTypes.DATE,      // DATETIME in SQL
  last_updated: {
    type: DataTypes.DATE,             // DATETIME in SQL
    allowNull: false
  },
  updated_by: DataTypes.STRING
}, {
  tableName: 'meter_reading',
  timestamps: false,
});

module.exports = Reading;
