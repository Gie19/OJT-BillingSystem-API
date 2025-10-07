// models/User.js
const { DataTypes } = require('sequelize');
const sequelize = require('./index');

const User = sequelize.define('User', {
  user_id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  user_password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  user_fullname: {
    type: DataTypes.STRING,
    allowNull: false
  },

  // ENUM -> becomes a CHECK constraint on MSSQL
  user_level: {
    type: DataTypes.ENUM('admin', 'operator', 'biller'),
    allowNull: false
  },

  // Admins may have null building_id
  building_id: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null
  },

  // Store small JSON as a string; (de)serialize here
  utility_role: {
    type: DataTypes.STRING(1000),
    allowNull: true,
    defaultValue: null,
    get() {
      const raw = this.getDataValue('utility_role');
      if (raw == null) return null;
      try { return JSON.parse(raw); } catch { return raw; }
    },
    set(value) {
      if (value == null) {
        this.setDataValue('utility_role', null);
      } else {
        this.setDataValue('utility_role', JSON.stringify(value));
      }
    }
  }
}, {
  tableName: 'user_accounts',
  timestamps: false
});

module.exports = User;
