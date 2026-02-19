const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const pool = require('../db');
require('dotenv').config();

const AUTH_SECRET = process.env.SECRET_KEY;

function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : header;
    if (!token) return res.status(401).json({ error: 'Токен отсутствует' });

    const decoded = jwt.verify(token, AUTH_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Неверный или просроченный токен' });
  }
}

// =============================
// GET /api/plans/categories - получить все категории тарифов
// =============================
router.get('/api/plans/categories', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM plan_categories ORDER BY category_id'
    );
    res.json({ categories: result.rows });
  } catch (err) {
    console.error('Error fetching plan categories:', err);
    res.status(500).json({ error: 'Ошибка при получении категорий тарифов' });
  }
});

// =============================
// GET /api/plans - получить все тарифы (с фильтрацией)
// Query params:
//   - categoryId: фильтр по категории
//   - userRole: фильтр по роли (user/vip-user)
// =============================
router.get('/api/plans', async (req, res) => {
  try {
    const { categoryId, userRole } = req.query;
    
    let query = `
      SELECT p.*, c.name as category_name, c.icon as category_icon
      FROM plans p
      LEFT JOIN plan_categories c ON p.category_id = c.category_id
      WHERE p.is_active = true
    `;
    
    const params = [];
    
    if (categoryId) {
      params.push(categoryId);
      query += ` AND p.category_id = $${params.length}`;
    }
    
    if (userRole) {
      // Фильтруем по типу плана в зависимости от роли
      if (userRole === 'vip-user') {
        query += ` AND p.plan_type = 'vip'`;
      } else if (userRole === 'user') {
        query += ` AND p.plan_type = 'standard'`;
      }
    }
    
    query += ' ORDER BY p.category_id, p.duration_days';
    
    const result = await pool.query(query, params);
    res.json({ plans: result.rows });
  } catch (err) {
    console.error('Error fetching plans:', err);
    res.status(500).json({ error: 'Ошибка при получении тарифов' });
  }
});

// =============================
// GET /api/plans/:id - получить конкретный тариф
// =============================
router.get('/api/plans/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `SELECT p.*, c.name as category_name, c.icon as category_icon
       FROM plans p
       LEFT JOIN plan_categories c ON p.category_id = c.category_id
       WHERE p.plan_id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Тариф не найден' });
    }
    
    res.json({ plan: result.rows[0] });
  } catch (err) {
    console.error('Error fetching plan:', err);
    res.status(500).json({ error: 'Ошибка при получении тарифа' });
  }
});

// =============================
// GET /api/subscriptions/network/:networkId - получить подписки сети
// =============================
router.get('/api/subscriptions/network/:networkId', authMiddleware, async (req, res) => {
  try {
    const { networkId } = req.params;
    
    const result = await pool.query(
      `SELECT s.*, p.name as plan_name, p.price, p.currency, p.duration_days, p.bonus_days,
              c.name as category_name
       FROM subscriptions s
       LEFT JOIN plans p ON s.plan_id = p.plan_id
       LEFT JOIN plan_categories c ON p.category_id = c.category_id
       WHERE s.network_id = $1
       ORDER BY s.end_date DESC`,
      [networkId]
    );
    
    res.json({ subscriptions: result.rows });
  } catch (err) {
    console.error('Error fetching subscriptions:', err);
    res.status(500).json({ error: 'Ошибка при получении подписок' });
  }
});

// =============================
// GET /api/subscriptions/branch/:branchId - получить подписки филиала (через сеть)
// =============================
router.get('/api/subscriptions/branch/:branchId', authMiddleware, async (req, res) => {
  try {
    const { branchId } = req.params;
    
    // Сначала находим network_id филиала
    const branchResult = await pool.query(
      'SELECT network_id FROM branches WHERE branch_id = $1',
      [branchId]
    );
    
    if (branchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Филиал не найден' });
    }
    
    const networkId = branchResult.rows[0].network_id;
    
    if (!networkId) {
      return res.json({ subscriptions: [] });
    }
    
    const result = await pool.query(
      `SELECT s.*, p.name as plan_name, p.price, p.currency, p.duration_days, p.bonus_days,
              c.name as category_name
       FROM subscriptions s
       LEFT JOIN plans p ON s.plan_id = p.plan_id
       LEFT JOIN plan_categories c ON p.category_id = c.category_id
       WHERE s.network_id = $1 AND s.status = 'active'
       ORDER BY s.end_date DESC`,
      [networkId]
    );
    
    res.json({ subscriptions: result.rows });
  } catch (err) {
    console.error('Error fetching branch subscriptions:', err);
    res.status(500).json({ error: 'Ошибка при получении подписок филиала' });
  }
});

// =============================
// POST /api/subscriptions - создать новую подписку
// Body: { networkId, planId, startDate (optional) }
// =============================
router.post('/api/subscriptions', authMiddleware, async (req, res) => {
  try {
    const { networkId, planId, startDate } = req.body;
    
    if (!networkId || !planId) {
      return res.status(400).json({ error: 'networkId и planId обязательны' });
    }
    
    // Получаем информацию о тарифе
    const planResult = await pool.query(
      'SELECT * FROM plans WHERE plan_id = $1',
      [planId]
    );
    
    if (planResult.rows.length === 0) {
      return res.status(404).json({ error: 'Тариф не найден' });
    }
    
    const plan = planResult.rows[0];
    const totalDays = plan.duration_days + (plan.bonus_days || 0);
    
    // Вычисляем даты подписки
    const start = startDate ? new Date(startDate) : new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + totalDays);
    
    // Создаем подписку
    const result = await pool.query(
      `INSERT INTO subscriptions (network_id, plan_id, start_date, end_date, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING *`,
      [networkId, planId, start, end]
    );
    
    res.status(201).json({ 
      subscription: result.rows[0],
      message: 'Подписка успешно создана'
    });
  } catch (err) {
    console.error('Error creating subscription:', err);
    res.status(500).json({ error: 'Ошибка при создании подписки' });
  }
});

// =============================
// PATCH /api/subscriptions/:id - обновить статус подписки
// Body: { status }
// =============================
router.patch('/api/subscriptions/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({ error: 'Статус обязателен' });
    }
    
    const result = await pool.query(
      `UPDATE subscriptions 
       SET status = $1
       WHERE subscription_id = $2
       RETURNING *`,
      [status, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Подписка не найдена' });
    }
    
    res.json({ 
      subscription: result.rows[0],
      message: 'Статус подписки обновлен'
    });
  } catch (err) {
    console.error('Error updating subscription:', err);
    res.status(500).json({ error: 'Ошибка при обновлении подписки' });
  }
});

// =============================
// GET /api/subscriptions/active/network/:networkId - получить активные подписки
// =============================
router.get('/api/subscriptions/active/network/:networkId', authMiddleware, async (req, res) => {
  try {
    const { networkId } = req.params;
    
    const result = await pool.query(
      `SELECT s.*, p.name as plan_name, p.price, p.currency,
              c.name as category_name, c.icon as category_icon
       FROM subscriptions s
       LEFT JOIN plans p ON s.plan_id = p.plan_id
       LEFT JOIN plan_categories c ON p.category_id = c.category_id
       WHERE s.network_id = $1 
         AND s.status = 'active'
         AND s.end_date >= NOW()
       ORDER BY s.end_date DESC`,
      [networkId]
    );
    
    res.json({ subscriptions: result.rows });
  } catch (err) {
    console.error('Error fetching active subscriptions:', err);
    res.status(500).json({ error: 'Ошибка при получении активных подписок' });
  }
});

module.exports = router;
