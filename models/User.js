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
  // Roles: admin | operator | biller
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

  // Stored as NVARCHAR(MAX) on MSSQL; Sequelize (de)serializes JSON
  utility_role: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null
  }
}, {
  tableName: 'user_accounts',
  timestamps: false
});

module.exports = User;
