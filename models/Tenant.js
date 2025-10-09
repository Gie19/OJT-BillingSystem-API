// models/Tenant.js
const { DataTypes } = require('sequelize');
const sequelize = require('./index');

const Tenant = sequelize.define('Tenant', {
  tenant_id: {
    type: DataTypes.STRING,
    primaryKey: true,
  },
  tenant_sn: {
    type: DataTypes.STRING,
    unique: true,
  },
  tenant_name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  building_id: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  vat_code: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null,
  },
  wt_code: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null,
  },
  for_penalty: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  tenant_status: {
    type: DataTypes.ENUM('active', 'inactive'),
    allowNull: false,
    defaultValue: 'active',
  },
  last_updated: {
    type: DataTypes.DATE, // DATETIME in SQL
    allowNull: false,
  },
  updated_by: {
    type: DataTypes.STRING,
    allowNull: false,
  },
}, {
  tableName: 'tenant_list',
  timestamps: false,
});

module.exports = Tenant;
