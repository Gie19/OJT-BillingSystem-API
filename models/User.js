const { DataTypes } = require('sequelize');
const sequelize = require('./index');

const User = sequelize.define('User', {
  user_id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  user_password: DataTypes.STRING,
  user_fullname: DataTypes.STRING, // DB is VARCHAR(50)
  // NEW role set per your schema
  user_level: DataTypes.ENUM('admin', 'operator', 'biller', 'reader'),
  // Nullable in DB; Sequelize doesn’t enforce NOT NULL unless specified
  building_id: DataTypes.STRING,
  // NEW: per-utility allow-list (JSON)
  utility_role: {
    type: DataTypes.JSON, // MariaDB stores JSON as LONGTEXT + CHECK (json_valid(...))
    allowNull: true,
    defaultValue: null
  }
}, {
  tableName: 'user_accounts',
  timestamps: false,
});

module.exports = User;
