const pool = require('./db');
const fs = require('fs');
const path = require('path');

async function fixPlanTypes() {
  try {
    console.log('🔧 Исправление plan_type значений...');
    
    // Читаем SQL файл
    const sqlPath = path.join(__dirname, 'fix-plan-types.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Выполняем SQL
    await pool.query(sql);
    
    console.log('✅ Plan types успешно обновлены!');
    console.log('');
    console.log('Проверьте результаты с помощью:');
    console.log('SELECT plan_id, name, plan_type, price, duration_days FROM plans ORDER BY price, duration_days;');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка при обновлении plan types:', error);
    process.exit(1);
  }
}

fixPlanTypes();
