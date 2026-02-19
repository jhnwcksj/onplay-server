const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function runMigration() {
  try {
    console.log('Начинаем миграцию для добавления таблиц аналитики...');
    
    // Читаем SQL файл миграции
    const migrationPath = path.join(__dirname, 'migrations', '003_add_analytics_tables.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    // Выполняем миграцию
    await pool.query(sql);
    
    console.log('✅ Миграция успешно выполнена!');
    console.log('✅ Таблицы analytics_daily, analytics_service_daily и expenses созданы');
    console.log('✅ Тестовые данные расходов добавлены');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка при выполнении миграции:', error);
    process.exit(1);
  }
}

runMigration();
