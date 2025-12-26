const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const pool = require('../db');

// тот же секрет, что и в auth.js / networks.js
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

// GET /users/:id/branches - return branches for a user (with networks)
router.get('/users/:id/branches', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT b.*, n.name AS network_name
         FROM branches b
         LEFT JOIN networks n ON n.network_id = b.network_id
         LEFT JOIN network_users nu ON nu.network_id = n.network_id
        WHERE b.user_id = $1 OR nu.user_id = $1
        ORDER BY n.name NULLS LAST, b.branch_id`,
      [id]
    );
    res.json({ branches: result.rows });
  } catch (err) {
    console.error('branches error', err);
    res.status(500).json({ error: 'Ошибка при получении филиалов' });
  }
});

// GET /branches?userId=... or ?user_id=... - alternate shape used by client (with networks)
router.get('/branches', async (req, res) => {
  const userId = req.query.userId || req.query.user_id;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    const result = await pool.query(
      `SELECT b.*, n.name AS network_name
         FROM branches b
         LEFT JOIN networks n ON n.network_id = b.network_id
         LEFT JOIN network_users nu ON nu.network_id = n.network_id
        WHERE b.user_id = $1 OR nu.user_id = $1
        ORDER BY n.name NULLS LAST, b.branch_id`,
      [userId]
    );
    res.json({ branches: result.rows });
  } catch (err) {
    console.error('branches list error', err);
    res.status(500).json({ error: 'Ошибка при получении филиалов' });
  }
});

// GET /branches/:id - return a single branch by id (with network)
router.get('/branches/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT b.*, n.name AS network_name
         FROM branches b
         LEFT JOIN networks n ON n.network_id = b.network_id
        WHERE b.branch_id = $1`,
      [id]
    );
    if (!result.rows || result.rows.length === 0) return res.status(404).json({ error: 'Branch not found' });
    res.json({ branch: result.rows[0] });
  } catch (err) {
    console.error('branch detail error', err);
    res.status(500).json({ error: 'Ошибка при получении филиала' });
  }
});

// POST /branches - создать новый филиал в сети текущего пользователя
router.post('/branches', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const {
    network_id,
    branch_name,
    company_name,
    category,
    country_code,
    city,
    notification_language,
    datetime_format,
    address,
    postal_code,
    phone,
    website,
    schedule,
    description,
    photo_url,
    requisites_type,
    legal_company_name,
    legal_address,
    actual_address,
    inn,
    kpp,
    bik,
    bank_name,
    correspondent_account,
    checking_account,
  } = req.body || {};

  if (!branch_name) {
    return res.status(400).json({ error: 'branch_name обязателен' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO branches (
         network_id, user_id, branch_name, company_name, category,
         country_code, city, notification_language, datetime_format,
         address, postal_code, phone, website, schedule,
         description, photo_url,
         requisites_type, legal_company_name, legal_address, actual_address,
         inn, kpp, bik, bank_name, correspondent_account, checking_account
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9,
         $10, $11, $12, $13, $14,
         $15, $16,
         $17, $18, $19, $20,
         $21, $22, $23, $24, $25, $26
       )
       RETURNING *`,
      [
        network_id || null,
        userId,
        branch_name,
        company_name || null,
        category || null,
        country_code || 'KZ',
        city || null,
        notification_language || null,
        datetime_format || null,
        address || null,
        postal_code || null,
        phone || null,
        website || null,
        schedule || null,
        description || null,
        photo_url || null,
        requisites_type || null,
        legal_company_name || null,
        legal_address || null,
        actual_address || null,
        inn || null,
        kpp || null,
        bik || null,
        bank_name || null,
        correspondent_account || null,
        checking_account || null,
      ]
    );

    return res.status(201).json({ branch: result.rows[0] });
  } catch (err) {
    console.error('create branch error', err);
    return res.status(500).json({ error: 'Ошибка при создании филиала' });
  }
});
// PATCH /branches/:id - обновить данные филиала (частично)
router.patch('/branches/:id', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const branchId = req.params.id;

  try {
    // Проверяем, что пользователь имеет отношение к филиалу (владелец филиала или сети)
    const perm = await pool.query(
      `SELECT 1
         FROM branches b
         LEFT JOIN networks n ON n.network_id = b.network_id
         LEFT JOIN network_users nu ON nu.network_id = n.network_id
        WHERE b.branch_id = $1
          AND (b.user_id = $2 OR nu.user_id = $2)
        LIMIT 1`,
      [branchId, userId]
    );

    if (!perm.rows || perm.rows.length === 0) {
      return res.status(403).json({ error: 'Нет прав на изменение этого филиала' });
    }

    const allowedFields = [
      'network_id',
      'branch_name',
      'company_name',
      'category',
      'country_code',
      'city',
      'notification_language',
      'datetime_format',
      'address',
      'postal_code',
      'phone',
      'website',
      'schedule',
      'description',
      'photo_url',
      'requisites_type',
      'legal_company_name',
      'legal_address',
      'actual_address',
      'inn',
      'kpp',
      'bik',
      'bank_name',
      'correspondent_account',
      'checking_account',
    ];

    const fields = [];
    const values = [];
    let idx = 1;

    for (const key of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
        fields.push(`${key} = $${idx++}`);
        values.push(req.body[key]);
      }
    }

    if (!fields.length) {
      return res.status(400).json({ error: 'Нет данных для обновления' });
    }

    values.push(branchId);

    const result = await pool.query(
      `UPDATE branches SET ${fields.join(', ')} WHERE branch_id = $${idx} RETURNING *`,
      values
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ error: 'Филиал не найден' });
    }

    return res.json({ branch: result.rows[0] });
  } catch (err) {
    console.error('update branch error', err);
    return res.status(500).json({ error: 'Ошибка при обновлении филиала' });
  }
});

// DELETE /branches/:id - удалить филиал
router.delete('/branches/:id', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const branchId = req.params.id;

  try {
    // Проверяем права доступа
    const perm = await pool.query(
      `SELECT 1
         FROM branches b
         LEFT JOIN networks n ON n.network_id = b.network_id
         LEFT JOIN network_users nu ON nu.network_id = n.network_id
        WHERE b.branch_id = $1
          AND (b.user_id = $2 OR nu.user_id = $2)
        LIMIT 1`,
      [branchId, userId]
    );

    if (!perm.rows || perm.rows.length === 0) {
      return res.status(403).json({ error: 'Нет прав на удаление этого филиала' });
    }

    // TODO: при необходимости добавить проверки на связанные записи (appointments и т.д.)
    const delRes = await pool.query('DELETE FROM branches WHERE branch_id = $1', [branchId]);
    if (!delRes.rowCount) {
      return res.status(404).json({ error: 'Филиал не найден' });
    }

    return res.json({ message: 'Филиал удалён' });
  } catch (err) {
    console.error('delete branch error', err);
    return res.status(500).json({ error: 'Ошибка при удалении филиала' });
  }
});

module.exports = router;

// GET /branches/:id/appointments - журнал записей филиала
// Опционально принимает ?date=YYYY-MM-DD и возвращает все записи на эту дату
router.get('/branches/:id/appointments', async (req, res) => {
  const { id } = req.params;
  const { date } = req.query; // ожидаем YYYY-MM-DD
  try {
    let result;

    if (date) {
      // Все записи на указанную дату с привязкой к зонам, данными услуги/клиента и цветом из appointment_meta
      result = await pool.query(
        `SELECT a.*,
                array_remove(array_agg(DISTINCT az.zone_id), NULL) AS zone_ids,
                s.name AS service_name,
                c.name AS client_name,
                c.phone AS client_phone,
                COALESCE(am.color, '#e0f9f3') AS color,
                am.category,
                am.extra
           FROM appointments a
           LEFT JOIN appointment_zones az ON az.appointment_id = a.id
           LEFT JOIN services s ON s.service_id = a.service_id
           LEFT JOIN clients c ON c.client_id = a.client_id
           LEFT JOIN appointment_meta am ON am.appointment_id = a.id
          WHERE a.branch_id = $1
            AND DATE(a.start_time) = $2::date
          GROUP BY a.id, s.name, c.name, c.phone, am.color, am.category, am.extra
          ORDER BY a.start_time ASC`,
        [id, date]
      );
    } else {
      // Последние 200 записей филиала (без фильтра по дате) с цветом из appointment_meta
      result = await pool.query(
        `SELECT a.*,
                array_remove(array_agg(DISTINCT az.zone_id), NULL) AS zone_ids,
                s.name AS service_name,
                c.name AS client_name,
                c.phone AS client_phone,
                COALESCE(am.color, '#e0f9f3') AS color,
                am.category,
                am.extra
           FROM appointments a
           LEFT JOIN appointment_zones az ON az.appointment_id = a.id
           LEFT JOIN services s ON s.service_id = a.service_id
           LEFT JOIN clients c ON c.client_id = a.client_id
           LEFT JOIN appointment_meta am ON am.appointment_id = a.id
          WHERE a.branch_id = $1
          GROUP BY a.id, s.name, c.name, c.phone, am.color, am.category, am.extra
          ORDER BY a.start_time DESC
          LIMIT 200`,
        [id]
      );
    }

    res.json({ appointments: result.rows || [] });
  } catch (err) {
    console.error('branch appointments error', err);
    res.status(500).json({ error: 'Ошибка при получении журнала записи' });
  }
});
