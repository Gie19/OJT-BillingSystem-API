// models/Tenant.js
const { DataTypes, Sequelize } = require('sequelize');
const sequelize = require('./index');

const Tenant = sequelize.define('Tenant', {
  tenant_id:    { type: DataTypes.STRING, primaryKey: true },
  tenant_sn:    { type: DataTypes.STRING, unique: true },
  tenant_name:  { type: DataTypes.STRING, allowNull: false },
  building_id:  { type: DataTypes.STRING, allowNull: false },

  // nullable code refs
  vat_code:     { type: DataTypes.STRING, allowNull: true, defaultValue: null },
  wt_code:      { type: DataTypes.STRING, allowNull: true, defaultValue: null },

  // penalty flag
  for_penalty:  { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

  tenant_status:{ type: DataTypes.ENUM('active','inactive'), allowNull:false, defaultValue:'active' },

  last_updated: { type: DataTypes.DATE, allowNull:false, defaultValue: Sequelize.NOW },
  updated_by:   { type: DataTypes.STRING, allowNull:false, defaultValue: 'System Admin' },
}, {
  tableName: 'tenant_list',
  timestamps: false,
});

module.exports = Tenant;

// ------------ Associations (add these after module.exports or before—either is fine) ------------
const VAT = require('./VAT');
const WT  = require('./WT');

// Match the aliases used in routes: as: 'vat' and as: 'wt'
Tenant.belongsTo(VAT, {
  foreignKey: 'vat_code',   // column on tenant_list
  targetKey: 'vat_code',    // column on vat_codes (NOT the PK tax_id)
  as: 'vat',
});

Tenant.belongsTo(WT, {
  foreignKey: 'wt_code',    // column on tenant_list
  targetKey: 'wt_code',     // column on wt_codes
  as: 'wt',
});
