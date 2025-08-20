const { DataTypes } = require('sequelize');
const sequelize = require('./index');

const Stall = sequelize.define('Stall', {
  stall_id: {
    type: DataTypes.STRING,
    primaryKey: true,
  },
  stall_sn: {
    type: DataTypes.STRING(30),
    allowNull: false,
    unique: true,
  },
  tenant_id: {
    type: DataTypes.STRING(30), // nullable FK
    allowNull: true,
  },
  building_id: {
    type: DataTypes.STRING(30), // required FK
    allowNull: false,
  },
  stall_status: {
    type: DataTypes.ENUM('occupied', 'available', 'under maintenance'),
    allowNull: false,
    defaultValue: 'available',
  },
  last_updated: {
    type: DataTypes.DATE, // DATETIME in SQL
    allowNull: false,
  },
  updated_by: {
    type: DataTypes.STRING(30),
    allowNull: false,
  },
}, {
  tableName: 'stall_list',
  timestamps: false,
});

module.exports = Stall;
