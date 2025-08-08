const { DataTypes } = require('sequelize');
const sequelize = require('./index');

const Meter = sequelize.define('Meter', {
  meter_id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  meter_type: DataTypes.ENUM('electric', 'water', 'lpg'),
  meter_sn: DataTypes.STRING,
  meter_mult: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  stall_id: DataTypes.STRING,      // Foreign key (not null)
  meter_status: DataTypes.ENUM('active', 'inactive'),
  // qr_id: DataTypes.STRING,     // REMOVED
  last_updated: {
    type: DataTypes.DATE,
    allowNull: false
  },
  updated_by: DataTypes.STRING
}, {
  tableName: 'meter_list',
  timestamps: false,
});

module.exports = Meter;
