// models/Rate.js
const { DataTypes } = require('sequelize');
const sequelize = require('./index');

const Rate = sequelize.define('Rate', {
  rate_id:   { type: DataTypes.STRING, primaryKey: true },
  tenant_id: { type: DataTypes.STRING(30), allowNull: false, unique: true },

  // Tenant-specific items that remain (MSSQL-safe + validations):
  e_vat: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00,
    validate: { min: 0 }
  },
  wnet_vat: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00,
    validate: { min: 0 }
  },
  w_vat: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00,
    validate: { min: 0 }
  },

  last_updated: { type: DataTypes.DATE, allowNull: false },
  updated_by:   { type: DataTypes.STRING(30), allowNull: false },
}, {
  tableName: 'utility_rate',
  timestamps: false,
});

module.exports = Rate;
