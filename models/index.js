// models/index.js (or wherever you init Sequelize)
require('dotenv').config();
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'mysql',
    logging: true,            // set false to quiet SQL logs

    // >>> Timezone & date handling <<<
    timezone: '+08:00',       // write dates as Asia/Manila
    dialectOptions: {
      dateStrings: true,      // return DATE/DATETIME as strings
      typeCast: (field, next) => {
        // keep DATETIME/TIMESTAMP as raw strings (no TZ conversion on read)
        if (field.type === 'DATETIME' || field.type === 'TIMESTAMP') {
          return field.string();
        }
        return next();
      },
    },
  }
);

module.exports = sequelize;
