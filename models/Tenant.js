const { DataTypes } = require('sequelize');
const sequelize = require('./index');

const Tenant = sequelize.define('Tenant', {
  tenant_id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  tenant_sn: {
    type: DataTypes.STRING,
    unique: true
  },
  tenant_name: DataTypes.STRING,
  building_id: DataTypes.STRING,
  bill_start: DataTypes.DATEONLY,   // <-- 'date' in SQL, use DATEONLY
  last_updated: DataTypes.DATE,     // <-- 'datetime' in SQL, use DATE
  updated_by: DataTypes.STRING
}, {
  tableName: 'tenant_list',
  timestamps: false,
});

module.exports = Tenant;
