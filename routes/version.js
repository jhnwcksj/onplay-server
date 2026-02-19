const express = require('express');
const router = express.Router();
const pool = require('../db');

/**
 * Версии API для различных разделов данных
 * Обновляйте эти версии при изменении структуры таблиц или формата данных
 */
const API_VERSIONS = {
  USER_DATA: '1.0.0',
  BRANCHES: '1.0.0',
  SERVICES: '1.0.0',
  ZONES: '1.0.0',
  CALENDAR: '1.0.0',
  APPOINTMENTS: '1.0.0',
  CLIENTS: '1.0.0',
  ANALYTICS: '1.0.0',
};

/**
 * GET /api/version/check - Проверка версии данных
 * Возвращает текущие версии API и информацию об обновлениях
 */
router.get('/check', async (req, res) => {
  try {
    const userId = req.user?.id;
    
    // Базовая информация о версиях
    const response = {
      versions: API_VERSIONS,
      serverTime: new Date().toISOString(),
    };
    
    // Если пользователь авторизован, добавляем персональную информацию
    if (userId) {
      // Проверяем последнее обновление данных пользователя — делаем три простых запроса,
      // чтобы избежать проблем с агрегатами и GROUP BY
      const userRes = await pool.query(
        'SELECT updated_at FROM users WHERE id = $1',
        [userId]
      );

      // branches table may not have updated_at column in some schemas — check first
      let lastBranch = null;
      try {
        const colCheck = await pool.query(
          `SELECT 1 FROM information_schema.columns WHERE table_name = 'branches' AND column_name = 'updated_at' LIMIT 1`
        );
        if (colCheck.rows.length > 0) {
          const branchesRes = await pool.query(
            `SELECT MAX(updated_at) AS last_branch_update
             FROM branches
             WHERE user_id = $1
                OR network_id IN (SELECT network_id FROM network_users WHERE user_id = $1)`,
            [userId]
          );
          lastBranch = branchesRes.rows[0]?.last_branch_update || null;
        } else {
          lastBranch = null;
        }
      } catch (err) {
        console.warn('[version] branches.updated_at check failed:', err.message);
        lastBranch = null;
      }

      const apptRes = await pool.query(
        `SELECT MAX(a.start_time) AS last_appointment
         FROM appointments a
         WHERE a.branch_id IN (
           SELECT branch_id FROM branches
           WHERE user_id = $1
              OR network_id IN (SELECT network_id FROM network_users WHERE user_id = $1)
         )`,
        [userId]
      );

      response.lastUpdates = {
        user: userRes.rows[0]?.updated_at || null,
        branches: lastBranch,
        appointments: apptRes.rows[0]?.last_appointment || null,
      };
    }
    
    res.json(response);
  } catch (error) {
    console.error('[version] /check error:', error);
    res.status(500).json({ error: 'Ошибка проверки версии' });
  }
});

/**
 * GET /api/version/info - Получить полную информацию о версиях и структуре данных
 */
router.get('/info', async (req, res) => {
  try {
    const info = {
      versions: API_VERSIONS,
      serverTime: new Date().toISOString(),
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'development',
    };
    
    // Информация о структуре БД (только для авторизованных пользователей)
    if (req.user) {
      try {
        const tablesResult = await pool.query(`
          SELECT 
            table_name,
            (SELECT COUNT(*) FROM information_schema.columns 
             WHERE table_name = t.table_name AND table_schema = 'public') as column_count
          FROM information_schema.tables t
          WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
          ORDER BY table_name
        `);
        
        info.database = {
          tables: tablesResult.rows,
          totalTables: tablesResult.rows.length,
        };
      } catch (dbError) {
        console.error('[version] Database info error:', dbError);
      }
    }
    
    res.json(info);
  } catch (error) {
    console.error('[version] /info error:', error);
    res.status(500).json({ error: 'Ошибка получения информации о версии' });
  }
});

/**
 * POST /api/version/update - Принудительное обновление версии для пользователя
 * (для администраторов или отладки)
 */
router.post('/update', async (req, res) => {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }
    
    // Обновляем timestamp в таблице пользователей
    await pool.query(
      'UPDATE users SET updated_at = NOW() WHERE id = $1',
      [userId]
    );
    
    res.json({
      success: true,
      message: 'Версия данных обновлена',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[version] /update error:', error);
    res.status(500).json({ error: 'Ошибка обновления версии' });
  }
});

/**
 * Middleware для обновления версий при изменении данных
 * Можно использовать в других роутах при создании/обновлении данных
 */
function triggerVersionUpdate(section) {
  return async (req, res, next) => {
    // Сохраняем оригинальный метод json
    const originalJson = res.json.bind(res);
    
    // Переопределяем json для логирования успешных операций
    res.json = function(data) {
      // Если операция успешна, обновляем timestamp
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const userId = req.user?.id;
        if (userId) {
          pool.query(
            'UPDATE users SET updated_at = NOW() WHERE id = $1',
            [userId]
          ).catch(err => console.error('[version] Update timestamp error:', err));
        }
      }
      
      return originalJson(data);
    };
    
    next();
  };
}

module.exports = router;
module.exports.triggerVersionUpdate = triggerVersionUpdate;
module.exports.API_VERSIONS = API_VERSIONS;
