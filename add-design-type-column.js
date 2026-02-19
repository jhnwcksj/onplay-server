const pool = require('./db');

async function addDesignTypeColumn() {
  const client = await pool.connect();
  
  try {
    console.log('Adding design_type column to branch_booking_settings...');
    
    await client.query('BEGIN');
    
    // Добавляем столбец design_type
    await client.query(`
      ALTER TABLE branch_booking_settings 
      ADD COLUMN IF NOT EXISTS design_type booking_design_type NOT NULL DEFAULT 'default';
    `);
    
    await client.query('COMMIT');
    
    console.log('✓ Column design_type added successfully');
    
    // Проверяем результат
    const result = await client.query(`
      SELECT column_name, data_type, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'branch_booking_settings' 
      AND column_name = 'design_type';
    `);
    
    console.log('\nColumn info:');
    console.table(result.rows);
    
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('✗ Error:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
  }
}

addDesignTypeColumn();
