const { DataTypes } = require('sequelize');
const sequelize = require('./index');

const Stall = sequelize.define('Stall', {
  stall_id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  stall_sn: {
    type: DataTypes.STRING,
    unique: true
  },
  tenant_id: DataTypes.STRING, // foreign key (can be NULL)
  building_id: DataTypes.STRING, // foreign key
  stall_status: DataTypes.ENUM('occupied', 'available', 'under maintenance'),
  last_updated: DataTypes.DATE,    // <-- 'datetime' in SQL, use DATE
  updated_by: DataTypes.STRING
}, {
  tableName: 'stall_list',
  timestamps: false,
});

module.exports = Stall;
