const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const pool = require('../db');
require('dotenv').config();

const AUTH_SECRET = process.env.SECRET_KEY;

// Middleware для проверки авторизации
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Invalid token format' });

  try {
    const decoded = jwt.verify(token, AUTH_SECRET);
    req.userId = decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// GET /api/calendar/:branchId - Получить все правила календаря для филиала
router.get('/:branchId', authMiddleware, async (req, res) => {
  const { branchId } = req.params;

  try {
    // Проверяем role пользователя - admin имеет доступ ко всем филиалам
    const userCheck = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [req.userId]
    );
    const userRole = userCheck.rows[0]?.role;
    
    // Admin bypass: allow access to any branch
    if (userRole !== 'admin') {
      // Проверяем доступ пользователя к филиалу
      // Пользователь имеет доступ если он владелец филиала или имеет доступ к сети
      const accessCheck = await pool.query(
        `SELECT 1 FROM branches b
         LEFT JOIN network_users nu ON nu.network_id = b.network_id
         WHERE b.branch_id = $1 
           AND (b.user_id = $2 OR nu.user_id = $2)
         LIMIT 1`,
        [branchId, req.userId]
      );

      if (accessCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied to this branch' });
      }
    }

    // Получаем правила недели
    const weekRules = await pool.query(
      `SELECT weekday, day_type 
       FROM branch_week_rules 
       WHERE branch_id = $1 
       ORDER BY weekday`,
      [branchId]
    );

    // Получаем исключения (праздники) с диапазонами дат
    const holidays = await pool.query(
      `SELECT 
         id,
         lower(date_range) as start_date,
         upper(date_range) - INTERVAL '1 day' as end_date,
         date_range,
         day_type, 
         title, 
         description,
         created_at
       FROM branch_calendar 
       WHERE branch_id = $1 
       ORDER BY lower(date_range)`,
      [branchId]
    );

    res.json({
      weekRules: weekRules.rows,
      holidays: holidays.rows.map(h => {
        // Форматируем даты как локальные без UTC конвертации
        const formatLocalDate = (date) => {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        };
        
        return {
          id: h.id,
          start_date: formatLocalDate(h.start_date),
          end_date: formatLocalDate(h.end_date),
          day_type: h.day_type,
          title: h.title,
          description: h.description,
          created_at: h.created_at
        };
      })
    });
  } catch (err) {
    console.error('Error fetching calendar:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/calendar/:branchId/week-rules - Обновить правило недели
router.post('/:branchId/week-rules', authMiddleware, async (req, res) => {
  const { branchId } = req.params;
  const { weekday, day_type } = req.body;

  // Валидация
  if (weekday === undefined || !day_type) {
    return res.status(400).json({ error: 'weekday and day_type are required' });
  }

  if (weekday < 0 || weekday > 6) {
    return res.status(400).json({ error: 'weekday must be between 0 and 6' });
  }

  if (!['weekday', 'weekend', 'holiday'].includes(day_type)) {
    return res.status(400).json({ error: 'Invalid day_type' });
  }

  try {
    // Проверяем role пользователя - admin имеет доступ ко всем филиалам
    const userCheck = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [req.userId]
    );
    const userRole = userCheck.rows[0]?.role;
    
    // Admin bypass: allow access to any branch
    if (userRole !== 'admin') {
      // Проверяем доступ
      const accessCheck = await pool.query(
        `SELECT 1 FROM branches b
         LEFT JOIN network_users nu ON nu.network_id = b.network_id
         WHERE b.branch_id = $1 
           AND (b.user_id = $2 OR nu.user_id = $2)
         LIMIT 1`,
        [branchId, req.userId]
      );

      if (accessCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied to this branch' });
      }
    }

    // Обновляем или создаем правило
    await pool.query(
      `INSERT INTO branch_week_rules (branch_id, weekday, day_type) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (branch_id, weekday) 
       DO UPDATE SET day_type = $3`,
      [branchId, weekday, day_type]
    );

    res.json({ success: true, message: 'Week rule updated' });
  } catch (err) {
    console.error('Error updating week rule:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/calendar/:branchId/holidays - Создать/обновить исключение
router.post('/:branchId/holidays', authMiddleware, async (req, res) => {
  const { branchId } = req.params;
  const { id, start_date, end_date, day_type, title, description } = req.body;

  // Валидация
  if (!start_date || !day_type) {
    return res.status(400).json({ error: 'start_date and day_type are required' });
  }

  if (!['weekday', 'weekend', 'holiday'].includes(day_type)) {
    return res.status(400).json({ error: 'Invalid day_type' });
  }

  // Проверяем формат даты
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(start_date) || (end_date && !dateRegex.test(end_date))) {
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
  }

  // Если end_date не указан, используем start_date
  const finalEndDate = end_date || start_date;

  try {
    // Проверяем role пользователя - admin имеет доступ ко всем филиалам
    const userCheck = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [req.userId]
    );
    const userRole = userCheck.rows[0]?.role;
    
    // Admin bypass: allow access to any branch
    if (userRole !== 'admin') {
      // Проверяем доступ
      const accessCheck = await pool.query(
        `SELECT 1 FROM branches b
         LEFT JOIN network_users nu ON nu.network_id = b.network_id
         WHERE b.branch_id = $1 
           AND (b.user_id = $2 OR nu.user_id = $2)
         LIMIT 1`,
        [branchId, req.userId]
      );

      if (accessCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied to this branch' });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (id) {
        // Удаляем старую запись, чтобы избежать конфликта EXCLUDE constraint
        await client.query(
          'DELETE FROM branch_calendar WHERE id = $1 AND branch_id = $2',
          [id, branchId]
        );
        
        // Создаем новую запись с обновленными данными
        await client.query(
          `INSERT INTO branch_calendar (branch_id, date_range, day_type, title, description, created_by) 
           VALUES ($1, daterange($2::date, ($3::date + INTERVAL '1 day')::date, '[)'), $4, $5, $6, $7)`,
          [branchId, start_date, finalEndDate, day_type, title || null, description || null, req.userId]
        );
      } else {
        // Создаем новое событие
        await client.query(
          `INSERT INTO branch_calendar (branch_id, date_range, day_type, title, description, created_by) 
           VALUES ($1, daterange($2::date, ($3::date + INTERVAL '1 day')::date, '[)'), $4, $5, $6, $7)`,
          [branchId, start_date, finalEndDate, day_type, title || null, description || null, req.userId]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      
      // Проверяем код ошибки конфликта EXCLUDE constraint
      if (err.code === '23P01') {
        client.release();
        return res.status(409).json({ 
          error: 'Событие на эту дату уже существует. Пожалуйста, выберите другую дату или удалите существующее событие.' 
        });
      }
      
      throw err;
    } finally {
      client.release();
    }

    res.json({ success: true, message: 'Holiday updated' });
  } catch (err) {
    console.error('Error updating holiday:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// DELETE /api/calendar/:branchId/holidays/:id - Удалить исключение
router.delete('/:branchId/holidays/:id', authMiddleware, async (req, res) => {
  const { branchId, id } = req.params;

  try {
    // Проверяем role пользователя - admin имеет доступ ко всем филиалам
    const userCheck = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [req.userId]
    );
    const userRole = userCheck.rows[0]?.role;
    
    // Admin bypass: allow access to any branch
    if (userRole !== 'admin') {
      // Проверяем доступ
      const accessCheck = await pool.query(
        `SELECT 1 FROM branches b
         LEFT JOIN network_users nu ON nu.network_id = b.network_id
         WHERE b.branch_id = $1 
           AND (b.user_id = $2 OR nu.user_id = $2)
         LIMIT 1`,
        [branchId, req.userId]
      );

      if (accessCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied to this branch' });
      }
    }

    // Удаляем исключение
    const result = await pool.query(
      `DELETE FROM branch_calendar 
       WHERE id = $1 AND branch_id = $2`,
      [id, branchId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Holiday not found' });
    }

    res.json({ success: true, message: 'Holiday deleted' });
  } catch (err) {
    console.error('Error deleting holiday:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
