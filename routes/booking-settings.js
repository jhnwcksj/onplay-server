const express = require('express');
const router = express.Router();
const pool = require('../db');
const crypto = require('crypto');

// Генерация уникального public_code для филиала (только случайный код)
function generatePublicCode() {
  // Генерируем случайный 8-символьный код
  return crypto.randomBytes(4).toString('hex');
}

// Middleware для проверки токена
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Токен не предоставлен' });
  }
  next();
}

// GET /api/booking-settings/setup - Получить информацию о филиалах для настройки
router.get('/setup', authenticateToken, async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) {
      return res.status(400).json({ error: 'userId обязателен' });
    }

    // Получаем филиалы пользователя с информацией о сети
    const branchesResult = await pool.query(`
      SELECT 
        b.branch_id,
        b.branch_name,
        b.public_code,
        b.network_id,
        n.name as network_name,
        n.slug as network_slug,
        bbs.is_enabled,
        bbs.flow_type,
        bbs.design_type,
        bbs.primary_color,
        bbs.secondary_color,
        bbs.show_prices,
        bbs.show_duration
      FROM branches b
      LEFT JOIN networks n ON b.network_id = n.network_id
      LEFT JOIN branch_booking_settings bbs ON b.branch_id = bbs.branch_id
      WHERE b.user_id = $1
      ORDER BY b.branch_name
    `, [userId]);

    const branches = branchesResult.rows;

    // Проверяем услуги и зоны, доступные для онлайн-записи
    const servicesResult = await pool.query(`
      SELECT 
        s.branch_id,
        COUNT(CASE WHEN s.is_online_available = TRUE THEN 1 END) as online_services_count,
        COUNT(*) as total_services_count
      FROM services s
      WHERE s.branch_id = ANY($1::bigint[])
      GROUP BY s.branch_id
    `, [branches.map(b => b.branch_id)]);

    const zonesResult = await pool.query(`
      SELECT 
        z.branch_id,
        COUNT(CASE WHEN z.is_booking_available = TRUE THEN 1 END) as booking_zones_count,
        COUNT(*) as total_zones_count
      FROM zones z
      WHERE z.branch_id = ANY($1::bigint[])
      GROUP BY z.branch_id
    `, [branches.map(b => b.branch_id)]);

    const servicesByBranch = {};
    servicesResult.rows.forEach(row => {
      servicesByBranch[row.branch_id] = {
        online_services_count: parseInt(row.online_services_count),
        total_services_count: parseInt(row.total_services_count)
      };
    });

    const zonesByBranch = {};
    zonesResult.rows.forEach(row => {
      zonesByBranch[row.branch_id] = {
        booking_zones_count: parseInt(row.booking_zones_count),
        total_zones_count: parseInt(row.total_zones_count)
      };
    });

    const enrichedBranches = branches.map(branch => {
      const services = servicesByBranch[branch.branch_id] || { online_services_count: 0, total_services_count: 0 };
      const zones = zonesByBranch[branch.branch_id] || { booking_zones_count: 0, total_zones_count: 0 };
      
      // Для филиалов без сети используем 'independent' как slug
      const effectiveSlug = branch.network_slug || 'independent';
      
      return {
        ...branch,
        online_services_count: services.online_services_count,
        total_services_count: services.total_services_count,
        booking_zones_count: zones.booking_zones_count,
        total_zones_count: zones.total_zones_count,
        needs_public_code: !branch.public_code,
        needs_network_slug: !branch.network_slug && branch.network_id,
        booking_url: branch.public_code 
          ? `/booking/${effectiveSlug}/${branch.public_code}`
          : null
      };
    });

    res.json({ branches: enrichedBranches });
  } catch (error) {
    console.error('[booking-settings] /setup error:', error);
    res.status(500).json({ error: 'Ошибка при загрузке данных' });
  }
});

// POST /api/booking-settings/generate-public-code - Сгенерировать/перегенерировать public_code для филиала
router.post('/generate-public-code', authenticateToken, async (req, res) => {
  try {
    const { branchId, force } = req.body;
    if (!branchId) {
      return res.status(400).json({ error: 'branchId обязателен' });
    }

    // Получаем информацию о филиале
    const branchResult = await pool.query(
      'SELECT branch_id, branch_name, public_code FROM branches WHERE branch_id = $1',
      [branchId]
    );

    if (branchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Филиал не найден' });
    }

    const branch = branchResult.rows[0];
    
    // Если уже есть public_code и не указан force, не генерируем новый
    if (branch.public_code && !force) {
      return res.json({ 
        success: true, 
        public_code: branch.public_code,
        message: 'Код уже существует'
      });
    }

    // Генерируем уникальный код
    let publicCode;
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      publicCode = generatePublicCode();
      
      // Проверяем уникальность
      const checkResult = await pool.query(
        'SELECT branch_id FROM branches WHERE public_code = $1',
        [publicCode]
      );

      if (checkResult.rows.length === 0) {
        break;
      }
      attempts++;
    }

    if (attempts >= maxAttempts) {
      return res.status(500).json({ error: 'Не удалось сгенерировать уникальный код' });
    }

    // Обновляем филиал
    await pool.query(
      'UPDATE branches SET public_code = $1 WHERE branch_id = $2',
      [publicCode, branchId]
    );

    res.json({ 
      success: true, 
      public_code: publicCode,
      message: force ? 'Код успешно перегенерирован' : 'Код успешно сгенерирован'
    });
  } catch (error) {
    console.error('[booking-settings] /generate-public-code error:', error);
    res.status(500).json({ error: 'Ошибка при генерации кода' });
  }
});

// GET /api/booking-settings/:branchId - Получить настройки онлайн-записи филиала
router.get('/:branchId', authenticateToken, async (req, res) => {
  try {
    const { branchId } = req.params;

    const result = await pool.query(`
      SELECT 
        branch_id,
        is_enabled,
        flow_type,
        design_type,
        primary_color,
        secondary_color,
        show_prices,
        show_duration,
        created_at,
        updated_at
      FROM branch_booking_settings
      WHERE branch_id = $1
    `, [branchId]);

    if (result.rows.length === 0) {
      // Возвращаем дефолтные настройки
      return res.json({
        branch_id: parseInt(branchId),
        is_enabled: true,
        flow_type: 'service_first',
        design_type: 'default',
        primary_color: null,
        secondary_color: null,
        show_prices: true,
        show_duration: true,
        created_at: null,
        updated_at: null
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('[booking-settings] GET /:branchId error:', error);
    res.status(500).json({ error: 'Ошибка при загрузке настроек' });
  }
});

// PUT /api/booking-settings/:branchId - Обновить настройки онлайн-записи филиала
router.put('/:branchId', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { branchId } = req.params;
    const {
      is_enabled,
      flow_type,
      design_type,
      primary_color,
      secondary_color,
      show_prices,
      show_duration
    } = req.body;

    await client.query('BEGIN');

    // Проверяем существование филиала
    const branchCheck = await client.query(
      'SELECT branch_id FROM branches WHERE branch_id = $1',
      [branchId]
    );

    if (branchCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Филиал не найден' });
    }

    // Вставляем или обновляем настройки
    const result = await client.query(`
      INSERT INTO branch_booking_settings (
        branch_id,
        is_enabled,
        flow_type,
        design_type,
        primary_color,
        secondary_color,
        show_prices,
        show_duration,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (branch_id) 
      DO UPDATE SET
        is_enabled = EXCLUDED.is_enabled,
        flow_type = EXCLUDED.flow_type,
        design_type = EXCLUDED.design_type,
        primary_color = EXCLUDED.primary_color,
        secondary_color = EXCLUDED.secondary_color,
        show_prices = EXCLUDED.show_prices,
        show_duration = EXCLUDED.show_duration,
        updated_at = NOW()
      RETURNING *
    `, [
      branchId,
      is_enabled ?? true,
      flow_type || 'service_first',
      design_type || 'default',
      primary_color,
      secondary_color,
      show_prices ?? true,
      show_duration ?? true
    ]);

    await client.query('COMMIT');

    res.json({ 
      success: true,
      settings: result.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[booking-settings] PUT /:branchId error:', error);
    res.status(500).json({ error: 'Ошибка при обновлении настроек' });
  } finally {
    client.release();
  }
});

module.exports = router;
