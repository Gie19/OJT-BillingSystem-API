const { DataTypes } = require('sequelize');
const sequelize = require('./index');

const Rate = sequelize.define('Rate', {
  rate_id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  tenant_id: {
    type: DataTypes.STRING(30),
    allowNull: false,
    unique: true
  },
  erate_perKwH: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  e_vat: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  emin_con: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  wmin_con: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  wrate_perCbM: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  wnet_vat: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  w_vat: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  lrate_perKg: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  last_updated: {
    type: DataTypes.DATE,   // DATETIME in SQL
    allowNull: false
  },
  updated_by: {
    type: DataTypes.STRING(30),
    allowNull: false
  }
}, {
  tableName: 'utility_rate',
  timestamps: false,
});

module.exports = Rate;
