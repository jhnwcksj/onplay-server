const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const pool = require('../db');
require('dotenv').config();

// тот же секрет, что и в auth.js / networks.js
const AUTH_SECRET = process.env.SECRET_KEY;

// Helper функция для получения timezone offset строки
// ВАЖНО: PostgreSQL TIMESTAMPTZ хранит данные с offset!
// Например: "2026-02-01 14:00:00+05" означает 14:00 в timezone +05:00
// НЕ нужно пересчитывать offset - он уже правильный в базе!
// Эта функция нужна только для создания новых записей
/**
 * Возвращает фиксированный offset для известных timezone
 */
function getTimezoneOffsetString(timezone) {
  // Фиксированные offset (не меняются от даты, не зависят от DST)
  const FIXED_OFFSETS = {
    'Asia/Almaty': '+05:00',      // Казахстан: UTC+5
    'Europe/Moscow': '+03:00',     // Россия: UTC+3
    'Asia/Bishkek': '+06:00',      // Кыргызстан: UTC+6
    'Asia/Tashkent': '+05:00',     // Узбекистан: UTC+5
    'Asia/Tbilisi': '+04:00',      // Грузия: UTC+4
    'Asia/Baku': '+04:00',         // Азербайджан: UTC+4
    'Asia/Yerevan': '+04:00',      // Армения: UTC+4
    'Europe/Minsk': '+03:00',      // Беларусь: UTC+3
    'UTC': '+00:00'
  };

  if (FIXED_OFFSETS[timezone]) {
    return FIXED_OFFSETS[timezone];
  }

  // Для остальных timezone используем динамический расчет
  try {
    // Используем ТЕКУЩУЮ дату для получения актуального offset
    const testDate = new Date();
    
    const utcFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    
    const tzFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    
    const utcParts = utcFormatter.formatToParts(testDate);
    const utcHour = parseInt(utcParts.find(p => p.type === 'hour').value);
    const utcMinute = parseInt(utcParts.find(p => p.type === 'minute').value);
    const utcDay = parseInt(utcParts.find(p => p.type === 'day').value);
    
    const tzParts = tzFormatter.formatToParts(testDate);
    const tzHour = parseInt(tzParts.find(p => p.type === 'hour').value);
    const tzMinute = parseInt(tzParts.find(p => p.type === 'minute').value);
    const tzDay = parseInt(tzParts.find(p => p.type === 'day').value);
    
    let offsetMinutes = (tzHour - utcHour) * 60 + (tzMinute - utcMinute);
    if (tzDay > utcDay) offsetMinutes += 24 * 60;
    else if (tzDay < utcDay) offsetMinutes -= 24 * 60;
    
    const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
    const offsetMins = Math.abs(offsetMinutes) % 60;
    const sign = offsetMinutes >= 0 ? '+' : '-';
    return `${sign}${String(offsetHours).padStart(2, '0')}:${String(offsetMins).padStart(2, '0')}`;
  } catch (e) {
    console.error('Error calculating timezone offset:', e);
    return '+05:00';
  }
}

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
    timezone,
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
    license_type, // Тип лицензии от frontend
  } = req.body || {};

  if (!branch_name) {
    return res.status(400).json({ error: 'branch_name обязателен' });
  }

  // Проверка роли пользователя для лимитов
  const userRoleResult = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
  const userRole = userRoleResult.rows[0]?.role || 'user';

  // Для user и vip-user проверяем лимит на количество филиалов (максимум 3)
  if (userRole === 'user' || userRole === 'vip-user') {
    const branchesCount = await pool.query('SELECT COUNT(*) FROM branches WHERE user_id = $1', [userId]);
    if (parseInt(branchesCount.rows[0].count) >= 3) {
      return res.status(403).json({ error: 'Вы можете создать максимум 3 филиала' });
    }
  }

  // Установка дат лицензии для бесплатного периода
  let valid_from = null;
  let valid_until = null;
  let license_status = null;

  if (license_type === 'free_trial') {
    const today = new Date();
    valid_from = today.toISOString().split('T')[0]; // Сегодня
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7); // +1 неделя
    valid_until = nextWeek.toISOString().split('T')[0];
    license_status = 'free_trial';
  } else if (license_type === 'paid') {
    license_status = 'paid';
  }

  try {
    const result = await pool.query(
      `INSERT INTO branches (
         network_id, user_id, branch_name, company_name, category,
         country_code, city, notification_language, datetime_format,
         address, postal_code, phone, website, schedule, timezone,
         description, photo_url,
         requisites_type, legal_company_name, legal_address, actual_address,
         inn, kpp, bik, bank_name, correspondent_account, checking_account,
         valid_from, valid_until, license_status
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9,
         $10, $11, $12, $13, $14, $15,
         $16, $17,
         $18, $19, $20, $21,
         $22, $23, $24, $25, $26, $27,
         $28, $29, $30
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
        timezone || 'Asia/Almaty',
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
        valid_from || null,
        valid_until || null,
        license_status || null,
      ]
    );

    const newBranch = result.rows[0];
    const newBranchId = newBranch.branch_id;

    // Создаем дефолтные правила недели: пн-пт будни, сб-вс выходные
    const weekRulesPromises = [
      // Понедельник - Пятница (1-5) = weekday
      pool.query(
        `INSERT INTO branch_week_rules (branch_id, weekday, day_type) VALUES ($1, 1, 'weekday')`,
        [newBranchId]
      ),
      pool.query(
        `INSERT INTO branch_week_rules (branch_id, weekday, day_type) VALUES ($1, 2, 'weekday')`,
        [newBranchId]
      ),
      pool.query(
        `INSERT INTO branch_week_rules (branch_id, weekday, day_type) VALUES ($1, 3, 'weekday')`,
        [newBranchId]
      ),
      pool.query(
        `INSERT INTO branch_week_rules (branch_id, weekday, day_type) VALUES ($1, 4, 'weekday')`,
        [newBranchId]
      ),
      pool.query(
        `INSERT INTO branch_week_rules (branch_id, weekday, day_type) VALUES ($1, 5, 'weekday')`,
        [newBranchId]
      ),
      // Суббота (6) = weekend
      pool.query(
        `INSERT INTO branch_week_rules (branch_id, weekday, day_type) VALUES ($1, 6, 'weekend')`,
        [newBranchId]
      ),
      // Воскресенье (0) = weekend
      pool.query(
        `INSERT INTO branch_week_rules (branch_id, weekday, day_type) VALUES ($1, 0, 'weekend')`,
        [newBranchId]
      ),
    ];

    await Promise.all(weekRulesPromises);

    return res.status(201).json({ branch: newBranch });
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
    // Проверяем role пользователя - admin имеет доступ ко всем филиалам
    const userCheck = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [userId]
    );
    const userRole = userCheck.rows[0]?.role;
    
    // Admin bypass: allow access to any branch
    if (userRole !== 'admin') {
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
      'timezone',
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
    // Проверяем role пользователя - admin имеет доступ ко всем филиалам
    const userCheck = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [userId]
    );
    const userRole = userCheck.rows[0]?.role;
    
    // Admin bypass: allow access to any branch
    if (userRole !== 'admin') {
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
// Опционально принимает ?service_ids[]=X&service_ids[]=Y для фильтрации по услугам
router.get('/branches/:id/appointments', async (req, res) => {
  const { id } = req.params;
  const { date } = req.query;
  const service_ids = req.query['service_ids[]']; // Express собирает service_ids[] параметры
  
  // console.log('GET /branches/:id/appointments - Params:', { id, date, service_ids, type: typeof service_ids, isArray: Array.isArray(service_ids) });
  
  try {
    let result;

    if (date) {
      // Сначала получаем timezone филиала
      const branchResult = await pool.query(
        `SELECT timezone FROM branches WHERE branch_id = $1`,
        [id]
      );
      const branchTimezone = (branchResult.rows && branchResult.rows[0] && branchResult.rows[0].timezone) || 'Asia/Almaty';

      // Подготовка фильтра по service_ids
      let serviceFilter = '';
      let queryParams = [id, date, branchTimezone];
      if (service_ids && service_ids.length > 0) {
        const serviceIdsArray = Array.isArray(service_ids) ? service_ids : [service_ids];
        serviceFilter = ` AND a.service_id = ANY($${queryParams.length + 1}::int[])`;
        queryParams.push(serviceIdsArray.map(id => parseInt(id)));
        // console.log('Service filter applied:', { serviceIdsArray, serviceFilter, queryParams });
      }

      // Все записи на указанную дату с привязкой к зонам, данными услуги/клиента и цветом из appointment_meta
      // Используем timezone филиала для корректного определения даты
      result = await pool.query(
        `SELECT a.*,
                array_remove(array_agg(DISTINCT az.zone_id), NULL) AS zone_ids,
                s.name AS service_name,
                c.name AS client_name,
                c.phone AS client_phone,
                c.email AS client_email,
                COALESCE(am.color, '#e0f9f3') AS color,
                am.category,
                am.extra
           FROM appointments a
           LEFT JOIN appointment_zones az ON az.appointment_id = a.id
           LEFT JOIN services s ON s.service_id = a.service_id
           LEFT JOIN clients c ON c.client_id = a.client_id
           LEFT JOIN appointment_meta am ON am.appointment_id = a.id
          WHERE a.branch_id = $1
            AND DATE(a.start_time AT TIME ZONE 'UTC' AT TIME ZONE $3) = $2::date${serviceFilter}
          GROUP BY a.id, s.name, c.name, c.phone, c.email, am.color, am.category, am.extra
          ORDER BY a.start_time ASC`,
        queryParams
      );

      // PostgreSQL TIMESTAMPTZ возвращает данные в UTC (как ISO строки)
      // НО данные изначально были сохранены с правильным timezone offset!
      // Нужно конвертировать UTC обратно в локальное время timezone филиала
      if (result.rows && result.rows.length > 0) {
        const tzOffset = getTimezoneOffsetString(branchTimezone);
        
        // Парсим offset: "+05:00" → +5 часов, "-05:00" → -5 часов
        const offsetMatch = tzOffset.match(/^([+-])(\d{2}):(\d{2})$/);
        const offsetSign = offsetMatch[1] === '+' ? 1 : -1;
        const offsetHours = parseInt(offsetMatch[2]);
        const offsetMinutes = parseInt(offsetMatch[3]);
        const totalOffsetMinutes = offsetSign * (offsetHours * 60 + offsetMinutes);
        
        result.rows = result.rows.map(row => {
          if (row.start_time) {
            // PostgreSQL возвращает ISO в UTC: "2026-02-01T09:00:00.000Z"
            // В базе хранится: "2026-02-01 14:00:00+05" (14:00 в Asia/Almaty)
            // Конвертируем UTC → локальное время ВРУЧНУЮ используя наш фиксированный offset
            const d = new Date(row.start_time);
            
            // Применяем offset вручную
            const localTime = new Date(d.getTime() + totalOffsetMinutes * 60 * 1000);
            
            // Форматируем результат
            const year = localTime.getUTCFullYear();
            const month = String(localTime.getUTCMonth() + 1).padStart(2, '0');
            const day = String(localTime.getUTCDate()).padStart(2, '0');
            const hour = String(localTime.getUTCHours()).padStart(2, '0');
            const minute = String(localTime.getUTCMinutes()).padStart(2, '0');
            const second = String(localTime.getUTCSeconds()).padStart(2, '0');
            
            row.start_time = `${year}-${month}-${day}T${hour}:${minute}:${second}${tzOffset}`;
          }
          if (row.end_time) {
            const d = new Date(row.end_time);
            const localTime = new Date(d.getTime() + totalOffsetMinutes * 60 * 1000);
            
            const year = localTime.getUTCFullYear();
            const month = String(localTime.getUTCMonth() + 1).padStart(2, '0');
            const day = String(localTime.getUTCDate()).padStart(2, '0');
            const hour = String(localTime.getUTCHours()).padStart(2, '0');
            const minute = String(localTime.getUTCMinutes()).padStart(2, '0');
            const second = String(localTime.getUTCSeconds()).padStart(2, '0');
            
            row.end_time = `${year}-${month}-${day}T${hour}:${minute}:${second}${tzOffset}`;
          }
          return row;
        });
      }
    } else {
      // Последние 200 записей филиала (без фильтра по дате) с цветом из appointment_meta
      result = await pool.query(
        `SELECT a.*,
                array_remove(array_agg(DISTINCT az.zone_id), NULL) AS zone_ids,
                s.name AS service_name,
                c.name AS client_name,
                c.phone AS client_phone,
                c.email AS client_email,
                COALESCE(am.color, '#e0f9f3') AS color,
                am.category,
                am.extra
           FROM appointments a
           LEFT JOIN appointment_zones az ON az.appointment_id = a.id
           LEFT JOIN services s ON s.service_id = a.service_id
           LEFT JOIN clients c ON c.client_id = a.client_id
           LEFT JOIN appointment_meta am ON am.appointment_id = a.id
          WHERE a.branch_id = $1
          GROUP BY a.id, s.name, c.name, c.phone, c.email, am.color, am.category, am.extra
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
