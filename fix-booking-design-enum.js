const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function fixBookingDesignEnum() {
  const client = await pool.connect();
  
  try {
    console.log('Fixing booking_design_type ENUM...');
    
    await client.query('BEGIN');
    
    // Проверяем, существует ли ENUM
    const enumCheck = await client.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM pg_type 
        WHERE typname = 'booking_design_type'
      ) as exists;
    `);
    
    if (enumCheck.rows[0].exists) {
      console.log('✓ ENUM booking_design_type exists, checking values...');
      
      // Получаем текущие значения ENUM
      const enumValues = await client.query(`
        SELECT e.enumlabel 
        FROM pg_enum e 
        JOIN pg_type t ON e.enumtypid = t.oid 
        WHERE t.typname = 'booking_design_type'
        ORDER BY e.enumsortorder;
      `);
      
      const currentValues = enumValues.rows.map(r => r.enumlabel);
      console.log('  Current values:', currentValues);
      
      // Проверяем, есть ли 'anotherworld_brand'
      if (!currentValues.includes('anotherworld_brand')) {
        console.log('  Adding "anotherworld_brand" value...');
        
        // Проверяем версию PostgreSQL для IF NOT EXISTS support
        const versionResult = await client.query('SHOW server_version_num');
        const version = parseInt(versionResult.rows[0].server_version_num);
        
        if (version >= 90300) {
          // PostgreSQL 9.3+ поддерживает IF NOT EXISTS для ALTER TYPE ADD VALUE
          try {
            await client.query(`ALTER TYPE booking_design_type ADD VALUE IF NOT EXISTS 'anotherworld_brand'`);
            console.log('  ✓ Added "anotherworld_brand"');
          } catch (err) {
            console.log('  Note:', err.message);
          }
        } else {
          await client.query(`ALTER TYPE booking_design_type ADD VALUE 'anotherworld_brand'`);
          console.log('  ✓ Added "anotherworld_brand"');
        }
      } else {
        console.log('  ✓ "anotherworld_brand" already exists');
      }
      
      // Обновляем записи с устаревшими значениями
      const updateResult = await client.query(`
        UPDATE branch_booking_settings 
        SET design_type = 'default'::booking_design_type 
        WHERE design_type::text NOT IN ('default', 'anotherworld_brand')
        RETURNING branch_id, design_type;
      `);
      
      if (updateResult.rowCount > 0) {
        console.log(`  ✓ Updated ${updateResult.rowCount} records to 'default'`);
      }
      
    } else {
      console.log('✓ ENUM does not exist, creating...');
      await client.query(`
        CREATE TYPE booking_design_type AS ENUM (
          'default',
          'anotherworld_brand'
        );
      `);
      console.log('  ✓ Created booking_design_type ENUM');
    }
    
    await client.query('COMMIT');
    console.log('✓ Fix completed successfully');
    process.exit(0);
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('✗ Fix failed:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
  }
}

fixBookingDesignEnum();
