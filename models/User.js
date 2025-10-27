// models/User.js
const { DataTypes } = require('sequelize');
const sequelize = require('./index');

// Small helper to keep arrays tidy
const toArray = (v) => Array.isArray(v) ? v : (v ? [v] : []);
const jsonGet = (self, key) => {
  try { return JSON.parse(self.getDataValue(key) || '[]'); }
  catch { return []; }
};
const jsonSet = (self, key, value) =>
  self.setDataValue(key, JSON.stringify(toArray(value)));

const User = sequelize.define('User', {
  user_id: {
    type: DataTypes.STRING(30),
    primaryKey: true,
    allowNull: false
  },

  user_password: {
    type: DataTypes.STRING(255),
    allowNull: false
  },

  user_fullname: {
    type: DataTypes.STRING(50),
    allowNull: false
  },

  // Keep storing JSON as NVARCHAR(MAX) on MSSQL via TEXT
  // NOTE: We use defaultValue '[]' and getters/setters for array behavior.

  // e.g., ["electric","water"]
  utility_role: {
    // On MSSQL, TEXT maps to NVARCHAR(MAX)
    type: DataTypes.TEXT,                // previously STRING(1000)
    allowNull: false,
    defaultValue: '[]',
    get() { return jsonGet(this, 'utility_role'); },
    set(v) { jsonSet(this, 'utility_role', v); }
  },

  // NEW: multi-role, e.g., ["admin","biller","reader"]
  user_roles: {
    type: DataTypes.TEXT,
    allowNull: false,
    defaultValue: '[]',
    get() { return jsonGet(this, 'user_roles'); },
    set(v) { jsonSet(this, 'user_roles', v); }
  },

  // NEW: multi-building, e.g., ["BLDG-1","BLDG-3"]
  building_ids: {
    type: DataTypes.TEXT,
    allowNull: false,
    defaultValue: '[]',
    get() { return jsonGet(this, 'building_ids'); },
    set(v) { jsonSet(this, 'building_ids', v); }
  }

}, {
  tableName: 'user_accounts',
  timestamps: false
});

module.exports = User;
