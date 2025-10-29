// models/Reading.js
const { DataTypes } = require('sequelize');
const sequelize = require('./index');

const Reading = sequelize.define('Reading', {
  reading_id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  meter_id: {
    type: DataTypes.STRING,
    allowNull: false
  },
  reading_value: {
    type: DataTypes.DECIMAL(30, 2),
    allowNull: false,
    defaultValue: 0.00,
    validate: { min: 0 } // mirrors UNSIGNED
  },
  read_by: {
    type: DataTypes.STRING,
    allowNull: false
  },
  lastread_date: {
    type: DataTypes.DATEONLY, // DATE in SQL
    allowNull: false
  },
  last_updated: {
    type: DataTypes.DATE,     // DATETIME in SQL
    allowNull: false
  },
  updated_by: {
    type: DataTypes.STRING,
    allowNull: false
  },
  remarks: {
    type: DataTypes.TEXT,          
    allowNull: true
  },
  image: {
    type: DataTypes.BLOB('long'),  
    allowNull: false
  }
}, {
  tableName: 'meter_reading',
  timestamps: false,
  indexes: [
    // Enforce ONE reading per meter per day
    { unique: true, fields: ['meter_id', 'lastread_date'] }
  ]
});

module.exports = Reading;
