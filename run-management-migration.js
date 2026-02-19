const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function runMigration() {
  try {
    console.log('Starting migration: Add management fields to branches table...');
    
    const migrationPath = path.join(__dirname, 'migrations', '005_add_management_fields.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    await pool.query(sql);
    
    console.log('✅ Migration completed successfully!');
    console.log('Added columns to branches: valid_from, valid_until, license_status');
    console.log('Created indexes for: role (users), license_status (branches), valid_until (branches)');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
