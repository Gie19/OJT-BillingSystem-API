'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Create fresh table using arrays-as-JSON (NVARCHAR(MAX) on MSSQL)
    await queryInterface.createTable('user_accounts', {
      user_id:       { type: Sequelize.STRING(30), allowNull: false, primaryKey: true },
      user_password: { type: Sequelize.STRING(255), allowNull: false },
      user_fullname: { type: Sequelize.STRING(50),  allowNull: false },

      // NEW: multi-role (e.g., ["admin","biller","reader"])
      user_roles:    { type: Sequelize.TEXT('long'), allowNull: false, defaultValue: '[]' },

      // NEW: multi-building (e.g., ["BLDG-1","BLDG-3"])
      building_ids:  { type: Sequelize.TEXT('long'), allowNull: false, defaultValue: '[]' },

      // Keep storing small JSON as text; model getter/setter (de)serializes
      utility_role:  { type: Sequelize.TEXT('long'), allowNull: false, defaultValue: '[]' },
    });

    // Enforce valid JSON for the three JSON-text columns (SQL Server 2016+)
    await queryInterface.sequelize.query(`
      ALTER TABLE user_accounts
      ADD CONSTRAINT CK_user_accounts_user_roles_ISJSON CHECK (ISJSON(user_roles) = 1);

      ALTER TABLE user_accounts
      ADD CONSTRAINT CK_user_accounts_building_ids_ISJSON CHECK (ISJSON(building_ids) = 1);

      ALTER TABLE user_accounts
      ADD CONSTRAINT CK_user_accounts_utility_role_ISJSON CHECK (ISJSON(utility_role) = 1);
    `);

    // Note: We intentionally do NOT add a foreign key to building_list because building_ids is an array.
    // If you want relational integrity, use a junction table (user_buildings) instead.
  },

  async down(queryInterface) {
    // Drop JSON constraints first (idempotent-ish)
    try {
      await queryInterface.sequelize.query(`
        IF EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_user_accounts_user_roles_ISJSON')
          ALTER TABLE user_accounts DROP CONSTRAINT CK_user_accounts_user_roles_ISJSON;

        IF EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_user_accounts_building_ids_ISJSON')
          ALTER TABLE user_accounts DROP CONSTRAINT CK_user_accounts_building_ids_ISJSON;

        IF EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_user_accounts_utility_role_ISJSON')
          ALTER TABLE user_accounts DROP CONSTRAINT CK_user_accounts_utility_role_ISJSON;
      `);
    } catch {}

    await queryInterface.dropTable('user_accounts');

    // No ENUM cleanup needed since we no longer create one.
  }
};
