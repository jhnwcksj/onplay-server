
const express = require('express');
const router = express.Router();
const db = require('../db');

// Получить все услуги (для фильтра)
router.get('/all-services', async (req, res) => {
    // console.log('DEBUG /all-services branch_id:', req.query.branch_id, 'branchId:', req.query.branchId);
  try {
    const branchId = req.query.branch_id || req.query.branchId;
    let query = 'SELECT service_id, name FROM services WHERE is_active = TRUE';
    const params = [];
    if (branchId) {
      query += ' AND branch_id = $1';
      params.push(branchId);
    }
    query += ' ORDER BY name';
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// router.get('/all-services', async (req, res) => {
//   const branchId = req.query.branchId;
//   console.log('branchId:', branchId);
//   if (!branchId) return res.status(400).json({ error: 'branchId required' });
//   try {
//     const result = await db.query(
//       'SELECT * FROM services WHERE branch_id = $1',
//       [branchId]
//     );
//     res.json(result.rows);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// Получить услуги с ценой по филиалу и зоне
// GET /branches/:branchId/zones/:zoneId/services
router.get('/branches/:branchId/zones/:zoneId/services', async (req, res) => {
  const { branchId, zoneId } = req.params;
  // dayType и время можно передавать через query, по умолчанию weekday
  const dayType = req.query.dayType || 'weekday';
  const time = req.query.time || null; // формат HH:MM
  try {
    const result = await db.query(`
            SELECT s.service_id, s.name, s.description, s.duration,
              s.pricing_type, s.max_participants, s.extra_person_price,
             sc.name AS category,
             sc.pricing_type AS category_pricing_type,
             sc.max_participants AS category_max_participants,
             sc.extra_person_price AS category_extra_person_price,
             COALESCE(sp_time.price, sp_any.price) AS price,
              (
           SELECT array_agg(DISTINCT sz2.zone_id)
           FROM service_zones sz2
           WHERE sz2.service_id = s.service_id
              ) AS linked_zone_ids
      FROM services s
      JOIN service_zones sz ON sz.service_id = s.service_id
      JOIN service_categories sc ON s.category_id = sc.category_id
      LEFT JOIN LATERAL (
        SELECT price
        FROM service_prices
        WHERE service_id = s.service_id
          AND (zone_id = $2 OR zone_id IS NULL)
          AND (branch_id = $1 OR branch_id IS NULL)
          AND day_type = $3
          AND ($4::time IS NULL OR (time_from IS NULL OR time_from <= $4::time) AND (time_to IS NULL OR time_to > $4::time))
        ORDER BY priority DESC, price ASC
        LIMIT 1
      ) sp_time ON TRUE
      LEFT JOIN LATERAL (
        SELECT price
        FROM service_prices
        WHERE service_id = s.service_id
          AND (zone_id = $2 OR zone_id IS NULL)
          AND (branch_id = $1 OR branch_id IS NULL)
          AND day_type = $3
        ORDER BY priority DESC, price ASC
        LIMIT 1
      ) sp_any ON TRUE
      WHERE sz.zone_id = $2
        AND sc.branch_id = $1
        AND s.is_active = TRUE
      ORDER BY sc.name, s.name
    `, [branchId, zoneId, dayType, time]);
    // console.log('services found:', result.rows);
    res.json({ services: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Получить категории услуг по филиалу
router.get('/service-categories', async (req, res) => {
  const branchId = req.query.branchId;
  if (!branchId) return res.status(400).json({ error: 'branchId required' });
  try {
    const result = await db.query(
      'SELECT * FROM service_categories WHERE branch_id = $1',
      [branchId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Создать категорию услуг
router.post('/service-categories', async (req, res) => {
  try {
    const {
      name,
      description,
      pricing_type,
      max_participants,
      extra_person_price,
      branchId,
      branch_id
    } = req.body || {};

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const finalBranchId = branchId || branch_id;
    if (!finalBranchId) {
      return res.status(400).json({ error: 'branchId is required' });
    }

    const finalPricingType = pricing_type || 'per_person';

    const result = await db.query(
      `INSERT INTO service_categories
        (name, description, pricing_type, max_participants, extra_person_price, branch_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        name,
        description || null,
        finalPricingType,
        max_participants != null ? max_participants : null,
        extra_person_price != null ? extra_person_price : null,
        finalBranchId
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Обновить категорию услуг
router.put('/service-categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      pricing_type,
      max_participants,
      extra_person_price
    } = req.body || {};

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const finalPricingType = pricing_type || 'per_person';

    const result = await db.query(
      `UPDATE service_categories
       SET name = $1,
           description = $2,
           pricing_type = $3,
           max_participants = $4,
           extra_person_price = $5
       WHERE category_id = $6
       RETURNING *`,
      [
        name,
        description || null,
        finalPricingType,
        max_participants != null ? max_participants : null,
        extra_person_price != null ? extra_person_price : null,
        id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'category not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Удалить категорию услуг
router.delete('/service-categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      'DELETE FROM service_categories WHERE category_id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'category not found' });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Получить услуги по категории
router.get('/services', async (req, res) => {
  const categoryId = req.query.categoryId;
  if (!categoryId) return res.status(400).json({ error: 'categoryId required' });
  try {
    const result = await db.query(
      'SELECT * FROM services WHERE category_id = $1',
      [categoryId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Создать услугу с привязкой к зонам и ценами
router.post('/services', async (req, res) => {
  const {
    categoryId,
    category_id,
    name,
    description,
    durationMinutes,
    duration,
    is_online_available,
    zoneIds,
    priceRules,
    branchId,
    branch_id,
    pricing_type
  } = req.body || {};

  try {
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const finalCategoryId = categoryId || category_id;
    if (!finalCategoryId) {
      return res.status(400).json({ error: 'categoryId is required' });
    }

    const finalBranchId = branchId || branch_id || null;
    const finalDuration = (Number.isInteger(duration) ? duration : null)
      ?? (Number.isInteger(durationMinutes) ? durationMinutes : null);
    const finalOnline = (typeof is_online_available === 'boolean')
      ? is_online_available
      : true;
    const finalPricingType = pricing_type || null;

    await db.query('BEGIN');

    const serviceResult = await db.query(
      `INSERT INTO services (category_id, name, description, duration, is_online_available, pricing_type, branch_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        finalCategoryId,
        name,
        description || null,
        finalDuration != null ? finalDuration : null,
        finalOnline,
        finalPricingType,
        finalBranchId
      ]
    );

    const service = serviceResult.rows[0];
    const serviceId = service.service_id;

    // Привязка к зонам (опционально)
    if (Array.isArray(zoneIds) && zoneIds.length) {
      for (const zid of zoneIds) {
        if (!zid) continue;
        await db.query(
          'INSERT INTO service_zones (service_id, zone_id) VALUES ($1, $2)',
          [serviceId, zid]
        );
      }
    }

    // Правила ценообразования (опционально)
    if (Array.isArray(priceRules) && priceRules.length) {
      for (const rule of priceRules) {
        if (!rule) continue;
        const dayType = rule.day_type || rule.dayType;
        if (!dayType) continue;

        let price = rule.price;
        if (typeof price === 'string') {
          price = parseInt(price, 10);
        }
        if (!Number.isFinite(price) || price <= 0) continue;

        const timeFrom = rule.time_from || rule.timeFrom || null;
        const timeTo = rule.time_to || rule.timeTo || null;
        const zoneId = rule.zone_id || rule.zoneId || null;
        const priority = rule.priority != null ? rule.priority : 1;

        await db.query(
          `INSERT INTO service_prices
             (service_id, day_type, time_from, time_to, price, zone_id, branch_id, priority)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            serviceId,
            dayType,
            timeFrom || null,
            timeTo || null,
            price,
            zoneId || null,
            finalBranchId,
            priority
          ]
        );
      }
    }

    await db.query('COMMIT');

    res.status(201).json(service);
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch (e) { /* ignore */ }
    res.status(500).json({ error: err.message });
  }
});

// Обновить услугу, её зоны и ценовые правила
router.put('/services/:id', async (req, res) => {
  const { id } = req.params;
  const {
    categoryId,
    category_id,
    name,
    description,
    durationMinutes,
    duration,
    is_online_available,
    zoneIds,
    priceRules,
    branchId,
    branch_id,
    pricing_type
  } = req.body || {};

  try {
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const finalCategoryId = categoryId || category_id;
    if (!finalCategoryId) {
      return res.status(400).json({ error: 'categoryId is required' });
    }

    const finalBranchId = branchId || branch_id || null;
    const finalDuration = (Number.isInteger(duration) ? duration : null)
      ?? (Number.isInteger(durationMinutes) ? durationMinutes : null);
    const finalOnline = (typeof is_online_available === 'boolean')
      ? is_online_available
      : true;
    const finalPricingType = pricing_type || null;

    await db.query('BEGIN');

    const serviceResult = await db.query(
      `UPDATE services
         SET category_id = $1,
             name = $2,
             description = $3,
             duration = $4,
             is_online_available = $5,
             pricing_type = $6,
             branch_id = $7
       WHERE service_id = $8
       RETURNING *`,
      [
        finalCategoryId,
        name,
        description || null,
        finalDuration != null ? finalDuration : null,
        finalOnline,
        finalPricingType,
        finalBranchId,
        id
      ]
    );

    if (serviceResult.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: 'service not found' });
    }

    const service = serviceResult.rows[0];

    // Сбрасываем старые связи зон и ценовые правила
    await db.query('DELETE FROM service_zones WHERE service_id = $1', [id]);
    await db.query('DELETE FROM service_prices WHERE service_id = $1', [id]);

    // Новые привязки к зонам (опционально)
    if (Array.isArray(zoneIds) && zoneIds.length) {
      for (const zid of zoneIds) {
        if (!zid) continue;
        await db.query(
          'INSERT INTO service_zones (service_id, zone_id) VALUES ($1, $2)',
          [id, zid]
        );
      }
    }

    // Новые правила ценообразования (опционально)
    if (Array.isArray(priceRules) && priceRules.length) {
      for (const rule of priceRules) {
        if (!rule) continue;
        const dayType = rule.day_type || rule.dayType;
        if (!dayType) continue;

        let price = rule.price;
        if (typeof price === 'string') {
          price = parseInt(price, 10);
        }
        if (!Number.isFinite(price) || price <= 0) continue;

        const timeFrom = rule.time_from || rule.timeFrom || null;
        const timeTo = rule.time_to || rule.timeTo || null;
        const zoneId = rule.zone_id || rule.zoneId || null;
        const priority = rule.priority != null ? rule.priority : 1;

        await db.query(
          `INSERT INTO service_prices
             (service_id, day_type, time_from, time_to, price, zone_id, branch_id, priority)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id,
            dayType,
            timeFrom || null,
            timeTo || null,
            price,
            zoneId || null,
            finalBranchId,
            priority
          ]
        );
      }
    }

    await db.query('COMMIT');
    res.json(service);
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch (e) { /* ignore */ }
    res.status(500).json({ error: err.message });
  }
});

// Удалить услугу вместе с её зонами и ценами
router.delete('/services/:id', async (req, res) => {
  const { id } = req.params;

  try {
    await db.query('BEGIN');

    await db.query('DELETE FROM service_zones WHERE service_id = $1', [id]);
    await db.query('DELETE FROM service_prices WHERE service_id = $1', [id]);

    const result = await db.query(
      'DELETE FROM services WHERE service_id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: 'service not found' });
    }

    await db.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch (e) { /* ignore */ }
    res.status(500).json({ error: err.message });
  }
});

// Получить связи услуг и зон
router.get('/service-zones', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM service_zones'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Получить все ценовые правила для услуги
router.get('/service-prices', async (req, res) => {
  try {
    const serviceId = req.query.serviceId || req.query.service_id;
    if (!serviceId) {
      return res.status(400).json({ error: 'serviceId required' });
    }

    const result = await db.query(
      `SELECT price_id, service_id, day_type, time_from, time_to,
              price, zone_id, branch_id, priority, created_at
         FROM service_prices
        WHERE service_id = $1
        ORDER BY price ASC`,
      [serviceId]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Обновить онлайн-доступность услуги
router.patch('/services/:id/online', async (req, res) => {
  try {
    const { id } = req.params;
    let { is_online_available } = req.body || {};

    if (typeof is_online_available === 'string') {
      if (is_online_available === 'true' || is_online_available === '1') is_online_available = true;
      else if (is_online_available === 'false' || is_online_available === '0') is_online_available = false;
    }

    const value = !!is_online_available;

    const result = await db.query(
      'UPDATE services SET is_online_available = $1 WHERE service_id = $2 RETURNING *',
      [value, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'service not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;