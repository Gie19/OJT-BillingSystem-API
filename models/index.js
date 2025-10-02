// models/index.js
require('dotenv').config();
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 1433,
    dialect: 'mssql',
    logging: true,

    // MSSQL (tedious) options:
    dialectOptions: {
      options: {
        encrypt: true,               // required on Azure; fine to keep on generally
        trustServerCertificate: true // okay for local/dev; turn off in prod with a proper cert
      }
    },
    // NOTE:
    // - Remove any MySQL-only options you may have had (timezone, dateStrings, typeCast).
    // - Pool settings are optional; defaults are fine to start with.
  }
);

module.exports = sequelize;
