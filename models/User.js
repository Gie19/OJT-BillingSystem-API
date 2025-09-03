const { DataTypes } = require('sequelize');
const sequelize = require('./index');

const User = sequelize.define('User', {
  user_id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  user_password: DataTypes.STRING,
  user_fullname: DataTypes.STRING,
  // Updated roles: admin | operator | biller
  user_level: DataTypes.ENUM('admin', 'operator', 'biller'),
  // Admins may have null building_id
  building_id: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null
  },
  // Only billers use this now; operators ignore it
  utility_role: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null
  }
}, {
  tableName: 'user_accounts',
  timestamps: false,
});

module.exports = User;
