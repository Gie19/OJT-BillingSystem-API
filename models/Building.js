const { DataTypes } = require('sequelize');
const sequelize = require('./index');

const Building = sequelize.define('Building', {
  building_id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  building_name: DataTypes.STRING,
  rate_id: DataTypes.STRING,     // Foreign key to utility_rate
  last_updated: {
    type: DataTypes.DATE,        // DATETIME in SQL
    allowNull: false
  },
  updated_by: DataTypes.STRING
}, {
  tableName: 'building_list',
  timestamps: false,
});

module.exports = Building;
