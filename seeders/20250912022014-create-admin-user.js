'use strict';

require('dotenv').config();
const { hashPassword } = require('../utils/hashPassword'); // keep your existing helper

module.exports = {
  up: async (queryInterface) => {
    // Idempotent check (MSSQL uses TOP 1)
    const [rows] = await queryInterface.sequelize.query(
      "SELECT TOP 1 user_id FROM user_accounts WHERE user_id = 'USER-1'"
    );
    if (rows && rows.length) return; // already seeded

    const plain = process.env.ADMIN_PASSWORD;
    const hashed = await hashPassword(plain);

    // Insert admin with arrays-as-JSON (valid JSON strings to satisfy ISJSON constraints)
    await queryInterface.bulkInsert('user_accounts', [
      {
        user_id: 'USER-1',
        user_password: hashed,
        user_fullname: 'System Admin',

        // NEW columns (arrays encoded as JSON text)
        user_roles: JSON.stringify(['admin']),
        building_ids: JSON.stringify([]),
        utility_role: JSON.stringify([]),
      }
    ], {});
  },

  down: async (queryInterface) => {
    await queryInterface.bulkDelete('user_accounts', { user_id: 'USER-1' }, {});
  }
};
