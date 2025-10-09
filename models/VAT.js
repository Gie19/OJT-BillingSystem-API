// models/VAT.js
const { DataTypes } = require('sequelize');
const sequelize = require('./index');

const VAT = sequelize.define('VAT', {
  tax_id:   { 
    type: DataTypes.STRING, 
    primaryKey: true, 
    allowNull: false 
  },
  vat_code: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'Z-PH',
    
  },
  vat_description: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'Zero Rated',
  },
  e_vat: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00,
    validate: { min: 0 },
  },
  w_vat: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00,
    validate: { min: 0 },
  },
  l_vat: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00,
    validate: { min: 0 }
  },
  
  last_updated: { type: DataTypes.DATE, allowNull: false },
  updated_by:   { type: DataTypes.STRING(30), allowNull: false },
}, {
  tableName: 'vat_codes',
  timestamps: false,
});

module.exports = VAT;
