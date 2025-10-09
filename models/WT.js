// models/WT.js
const { DataTypes, Sequelize } = require('sequelize');
const sequelize = require('./index');

const WT = sequelize.define('WT', {
  wt_id:   { 
    type: DataTypes.STRING(30),
    primaryKey: true, 
    allowNull: false 
  },
  wt_code: {
    type: DataTypes.STRING(30),
    allowNull: false,
    defaultValue: 'WC158',
    // uniqueness enforced in indexes below
  },
  wt_description: {
    type: DataTypes.STRING(100),
    allowNull: false,
    defaultValue: 'Insert Description',
  },
  // Percent points (e.g., 1.00 = 1%) — match VAT style
  e_wt: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 1.00,
    validate: { min: 0, max: 100 },
  },
  w_wt: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 1.00,
    validate: { min: 0, max: 100 },
  },
  l_wt: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 1.00,
    validate: { min: 0, max: 100 },
  },
  last_updated: { 
    type: DataTypes.DATE, 
    allowNull: false,
    defaultValue: Sequelize.NOW,
  },
  updated_by:   { 
    type: DataTypes.STRING(30), 
    allowNull: false,
    defaultValue: 'System Admin',
  },
}, {
  tableName: 'wt_codes',
  timestamps: false,
  indexes: [
    { unique: true, fields: ['wt_code'], name: 'ux_wt_codes_wt_code' },
  ],
});

module.exports = WT;
