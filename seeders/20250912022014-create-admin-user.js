'use strict';

require('dotenv').config();
const { hashPassword } = require('../utils/hashPassword'); // keep your existing helper

module.exports = {
  up: async (queryInterface) => {
    // Idempotent check (MSSQL syntax: TOP 1 instead of LIMIT 1)
    const [rows] = await queryInterface.sequelize.query(
      "SELECT TOP 1 user_id FROM user_accounts WHERE user_id = 'USER-1'"
    );
    if (rows.length) {
      // Already seeded — do nothing
      return;
    }

    const plain = process.env.ADMIN_PASSWORD || 'admin123';
    const hashed = await hashPassword(plain);

    // Insert admin (admins may have NULL building_id)
    await queryInterface.bulkInsert('user_accounts', [
      {
        user_id: 'USER-1',
        user_password: hashed,
        user_fullname: 'System Admin',
        user_level: 'admin',
        building_id: null,
        utility_role: null
      }
    ], {});
  },

  down: async (queryInterface) => {
    await queryInterface.bulkDelete('user_accounts', { user_id: 'USER-1' }, {});
  }
};
