const { DataTypes } = require('sequelize');
const sequelize = require('./index');

const Qr = sequelize.define('Qr', {
  qr_id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  generated_date: {
    type: DataTypes.DATE,  // DATETIME in SQL
    allowNull: false
  },
  generated_by: {
    type: DataTypes.STRING,
    allowNull: false
  }
}, {
  tableName: 'qr_details',
  timestamps: false,
});

module.exports = Qr;
