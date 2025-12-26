const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const router = express.Router();

// тот же секрет, что и в auth.js
const AUTH_SECRET = 'SECRET_KEY';

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

// POST /networks - создать новую сеть и привязать к текущему пользователю как owner
router.post('/networks', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { name, slug, description } = req.body || {};

  if (!name || !slug) {
    return res.status(400).json({ error: 'Название обязательны' });
  }

  try {
    await pool.query('BEGIN');

    const netRes = await pool.query(
      'INSERT INTO networks (name, description, slug) VALUES ($1, $2, $3) RETURNING *',
      [name, description || null, slug]
    );
    const network = netRes.rows[0];

    await pool.query(
      'INSERT INTO network_users (network_id, user_id, role) VALUES ($1, $2, $3)',
      [network.network_id, userId, 'owner']
    );

    await pool.query('COMMIT');

    res.status(201).json({
      message: 'Сеть создана',
      network,
    });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('create network error', err);
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Название уже используется' });
    }
    res.status(500).json({ error: 'Ошибка при создании сети' });
  }
});

// GET /networks - список сетей текущего пользователя
router.get('/networks', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(
      `SELECT n.*, nu.role
         FROM networks n
         JOIN network_users nu ON nu.network_id = n.network_id
        WHERE nu.user_id = $1
        ORDER BY n.network_id ASC`,
      [userId]
    );
    res.json({ networks: result.rows || [] });
  } catch (err) {
    console.error('list networks error', err);
    res.status(500).json({ error: 'Ошибка при получении сетей' });
  }
});

// PATCH /networks/:id - изменить название / описание сети (только owner)
router.patch('/networks/:id', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const networkId = req.params.id;
  const { name, description } = req.body || {};

  try {
    // Проверяем, что пользователь владелец сети
    const perm = await pool.query(
      'SELECT 1 FROM network_users WHERE network_id = $1 AND user_id = $2 AND role = $3',
      [networkId, userId, 'owner']
    );
    if (!perm.rows || perm.rows.length === 0) {
      return res.status(403).json({ error: 'Нет прав на изменение этой сети' });
    }

    const fields = [];
    const values = [];
    let idx = 1;

    if (typeof name === 'string') {
      fields.push(`name = $${idx++}`);
      values.push(name);
    }
    if (typeof description === 'string') {
      fields.push(`description = $${idx++}`);
      values.push(description || null);
    }

    if (!fields.length) {
      return res.status(400).json({ error: 'Нет данных для обновления' });
    }

    values.push(networkId);

    const result = await pool.query(
      `UPDATE networks SET ${fields.join(', ')} WHERE network_id = $${idx} RETURNING *`,
      values
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ error: 'Сеть не найдена' });
    }

    res.json({ network: result.rows[0] });
  } catch (err) {
    console.error('update network error', err);
    res.status(500).json({ error: 'Ошибка при обновлении сети' });
  }
});

// DELETE /networks/:id - удалить сеть (только owner, если нет филиалов)
router.delete('/networks/:id', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const networkId = req.params.id;

  try {
    // Проверяем, что пользователь владелец сети
    const perm = await pool.query(
      'SELECT 1 FROM network_users WHERE network_id = $1 AND user_id = $2 AND role = $3',
      [networkId, userId, 'owner']
    );
    if (!perm.rows || perm.rows.length === 0) {
      return res.status(403).json({ error: 'Нет прав на удаление этой сети' });
    }

    // Проверяем, что в сети нет филиалов
    const branches = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM branches WHERE network_id = $1',
      [networkId]
    );
    const cnt = (branches.rows && branches.rows[0] && branches.rows[0].cnt) || 0;
    if (cnt > 0) {
      return res.status(400).json({ error: 'Сначала удалите или отвяжите филиалы этой сети' });
    }

    await pool.query('DELETE FROM network_users WHERE network_id = $1', [networkId]);
    const delRes = await pool.query('DELETE FROM networks WHERE network_id = $1', [networkId]);
    if (!delRes.rowCount) {
      return res.status(404).json({ error: 'Сеть не найдена' });
    }

    res.json({ message: 'Сеть удалена' });
  } catch (err) {
    console.error('delete network error', err);
    res.status(500).json({ error: 'Ошибка при удалении сети' });
  }
});

module.exports = router;
