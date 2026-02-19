const pool = require('./db');

async function checkTable() {
  try {
    console.log('Checking branch_booking_settings table...\n');
    
    // Проверяем существование таблицы
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'branch_booking_settings'
      );
    `);
    
    console.log('Table exists:', tableExists.rows[0].exists);
    
    if (tableExists.rows[0].exists) {
      // Получаем структуру таблицы
      const columns = await pool.query(`
        SELECT column_name, data_type, column_default, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'branch_booking_settings'
        ORDER BY ordinal_position;
      `);
      
      console.log('\nTable structure:');
      console.table(columns.rows);
    }
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

checkTable();
