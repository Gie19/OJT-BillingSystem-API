// config.js
require('dotenv').config();

const base = {
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 1433,
  dialect: 'mssql',
  logging: false,
  dialectOptions: {
    options: {
      encrypt: true,               // keep true, required on Azure and generally safe
      trustServerCertificate: true // fine for local/dev; use a real cert in prod
    }
  },
  // Optional: tweak the pool if you like
  pool: { max: 10, min: 0, idle: 10000 }
};

module.exports = {
  development: { ...base },
  test: {
    ...base,
    database: `${process.env.DB_NAME}_test`
  },
  production: { ...base }
};
