const pool = require('./db');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    console.log('Запуск миграции 006_add_plans_subscriptions.sql...');
    
    const migrationPath = path.join(__dirname, 'migrations', '006_add_plans_subscriptions.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    await pool.query(sql);
    
    console.log('✅ Миграция успешно выполнена!');
    console.log('Созданы таблицы:');
    console.log('  - plan_categories');
    console.log('  - plans');
    console.log('  - subscriptions');
    console.log('');
    console.log('Добавлены начальные данные:');
    console.log('  - 3 категории (VR, Бильярд, Техосмотр)');
    console.log('  - 24 тарифа (по 4 периода для каждой категории и роли)');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка при выполнении миграции:', error);
    process.exit(1);
  }
}

runMigration();
