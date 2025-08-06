const { DataTypes } = require('sequelize');
const sequelize = require('./index');

const User = sequelize.define('User', {
  user_id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  user_password: DataTypes.STRING,
  user_fullname: DataTypes.STRING,
  user_level: DataTypes.ENUM('admin', 'employee'),
  building_id: DataTypes.STRING,
}, {
  tableName: 'user_accounts',
  timestamps: false,
});

module.exports = User;
