const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function runBookingMigration() {
  try {
    console.log('Running online booking migration...');
    
    const migrationPath = path.join(__dirname, 'migrations', '004_add_online_booking.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    await pool.query(sql);
    
    console.log('✓ Online booking migration completed successfully');
    process.exit(0);
  } catch (err) {
    console.error('✗ Migration failed:', err);
    process.exit(1);
  }
}

runBookingMigration();
