const express = require('express');
const router = express.Router();
const pool = require('../db');
const crypto = require('crypto');
const { getTimezoneOffsetString } = require('../utils/timezone');

// GET /api/online-booking/network/:slug - Получить информацию о сети и её филиалах
router.get('/network/:slug', async (req, res) => {
  try {
    const { slug } = req.params;

    // Получаем информацию о сети
    const networkResult = await pool.query(`
      SELECT network_id, name, slug, description
      FROM networks
      WHERE slug = $1
    `, [slug]);

    if (networkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Сеть не найдена' });
    }

    const network = networkResult.rows[0];

    // Получаем филиалы сети с включенной онлайн-записью
    const branchesResult = await pool.query(`
      SELECT 
        b.branch_id,
        b.branch_name,
        b.public_code,
        b.address,
        b.phone,
        b.timezone,
        bbs.is_enabled,
        bbs.flow_type,
        bbs.design_type,
        bbs.primary_color,
        bbs.secondary_color,
        bbs.show_prices,
        bbs.show_duration
      FROM branches b
      LEFT JOIN branch_booking_settings bbs ON b.branch_id = bbs.branch_id
      WHERE b.network_id = $1 
        AND b.public_code IS NOT NULL
        AND (bbs.is_enabled IS NULL OR bbs.is_enabled = TRUE)
      ORDER BY b.branch_name
    `, [network.network_id]);

    if (branchesResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'В этой сети нет доступных филиалов для онлайн-записи' 
      });
    }

    res.json({
      network,
      branches: branchesResult.rows
    });
  } catch (error) {
    console.error('[online-booking] /network/:slug error:', error);
    res.status(500).json({ error: 'Ошибка при загрузке данных сети' });
  }
});

// GET /api/online-booking/branch-direct/:publicCode - Получить информацию о филиале без сети
router.get('/branch-direct/:publicCode', async (req, res) => {
  try {
    const { publicCode } = req.params;

    // Получаем информацию о филиале (даже без network_id)
    const branchResult = await pool.query(`
      SELECT 
        b.branch_id,
        b.branch_name,
        b.public_code,
        b.address,
        b.phone,
        b.timezone,
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
      WHERE b.public_code = $1
    `, [publicCode]);

    if (branchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Филиал не найден' });
    }

    const branch = branchResult.rows[0];

    // Проверяем, включена ли онлайн-запись
    if (branch.is_enabled === false) {
      return res.status(403).json({ 
        error: 'Онлайн-запись для этого филиала отключена' 
      });
    }

    res.json({ branch });
  } catch (error) {
    console.error('[online-booking] /branch-direct/:publicCode error:', error);
    res.status(500).json({ error: 'Ошибка при загрузке данных филиала' });
  }
});

// GET /api/online-booking/branch/:slug/:publicCode - Получить информацию о филиале
router.get('/branch/:slug/:publicCode', async (req, res) => {
  try {
    const { slug, publicCode } = req.params;

    // Получаем информацию о филиале
    const branchResult = await pool.query(`
      SELECT 
        b.branch_id,
        b.branch_name,
        b.public_code,
        b.address,
        b.phone,
        b.timezone,
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
      WHERE n.slug = $1 
        AND b.public_code = $2
    `, [slug, publicCode]);

    if (branchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Филиал не найден' });
    }

    const branch = branchResult.rows[0];

    // Проверяем, включена ли онлайн-запись
    if (branch.is_enabled === false) {
      return res.status(403).json({ error: 'Онлайн-запись для этого филиала отключена' });
    }

    res.json({ branch });
  } catch (error) {
    console.error('[online-booking] /branch/:slug/:publicCode error:', error);
    res.status(500).json({ error: 'Ошибка при загрузке данных филиала' });
  }
});

// GET /api/online-booking/services/:branchId - Получить услуги филиала для онлайн-записи
router.get('/services/:branchId', async (req, res) => {
  try {
    const { branchId } = req.params;

    const servicesResult = await pool.query(`
      SELECT 
        s.service_id,
        s.name as service_name,
        s.description,
        s.duration,
        s.is_online_available,
        s.pricing_type,
        s.max_participants,
        sc.name as category_name,
        COALESCE(
          json_agg(
            json_build_object(
              'day_type', sp.day_type,
              'price', sp.price,
              'time_from', sp.time_from,
              'time_to', sp.time_to
            ) ORDER BY sp.day_type
          ) FILTER (WHERE sp.price_id IS NOT NULL),
          '[]'::json
        ) as prices,
        (
          SELECT array_agg(DISTINCT sz.zone_id)
          FROM service_zones sz
          WHERE sz.service_id = s.service_id
        ) AS linked_zone_ids
      FROM services s
      LEFT JOIN service_categories sc ON s.category_id = sc.category_id
      LEFT JOIN service_prices sp ON s.service_id = sp.service_id
      WHERE s.branch_id = $1 
        AND s.is_online_available = TRUE
        AND s.is_active = TRUE
      GROUP BY s.service_id, s.name, s.description, s.duration, s.is_online_available, s.pricing_type, s.max_participants, sc.name
      ORDER BY sc.name, s.name
    `, [branchId]);

    res.json({ services: servicesResult.rows });
  } catch (error) {
    console.error('[online-booking] /services/:branchId error:', error);
    res.status(500).json({ error: 'Ошибка при загрузке услуг' });
  }
});

// GET /api/online-booking/zones/:branchId - Получить зоны филиала для онлайн-записи
router.get('/zones/:branchId', async (req, res) => {
  try {
    const { branchId } = req.params;

    const zonesResult = await pool.query(`
      SELECT 
        z.zone_id,
        z.name as zone_name,
        z.capacity,
        z.is_booking_available
      FROM zones z
      WHERE z.branch_id = $1 
        AND z.is_booking_available = TRUE
      ORDER BY z.name
    `, [branchId]);

    res.json({ zones: zonesResult.rows });
  } catch (error) {
    console.error('[online-booking] /zones/:branchId error:', error);
    res.status(500).json({ error: 'Ошибка при загрузке зон' });
  }
});

// GET /api/online-booking/zones-by-service/:serviceId - Получить зоны для конкретной услуги
router.get('/zones-by-service/:serviceId', async (req, res) => {
  try {
    const { serviceId } = req.params;

    const zonesResult = await pool.query(`
      SELECT 
        z.zone_id,
        z.name as zone_name,
        z.capacity,
        z.is_booking_available
      FROM zones z
      INNER JOIN service_zones sz ON z.zone_id = sz.zone_id
      WHERE sz.service_id = $1 
        AND z.is_booking_available = TRUE
      ORDER BY z.capacity ASC, z.name
    `, [serviceId]);

    res.json({ zones: zonesResult.rows });
  } catch (error) {
    console.error('[online-booking] /zones-by-service/:serviceId error:', error);
    res.status(500).json({ error: 'Ошибка при загрузке зон для услуги' });
  }
});

// GET /api/online-booking/available-times - Получить доступные временные слоты
router.get('/available-times', async (req, res) => {
  try {
    const { branchId, date, participants } = req.query;

    // console.log('[available-times] Request params:', { branchId, date, participants });

    if (!branchId || !date || !participants) {
      const missing = [];
      if (!branchId) missing.push('branchId');
      if (!date) missing.push('date');
      if (!participants) missing.push('participants');
      
      console.error('[available-times] Missing parameters:', missing);
      return res.status(400).json({ 
        error: `Необходимы параметры: ${missing.join(', ')}` 
      });
    }

    // Получаем timezone филиала
    // console.log('[available-times] Fetching branch timezone...');
    const branchResult = await pool.query(
      'SELECT timezone FROM branches WHERE branch_id = $1',
      [branchId]
    );

    if (branchResult.rows.length === 0) {
      console.error('[available-times] Branch not found:', branchId);
      return res.status(404).json({ error: 'Филиал не найден' });
    }

    const branchTimezone = branchResult.rows[0].timezone || 'Asia/Almaty';
    // console.log('[available-times] Branch timezone:', branchTimezone);

    // Получаем все зоны филиала с достаточной вместимостью
    // console.log('[available-times] Fetching zones...');
    const zonesResult = await pool.query(`
      SELECT zone_id, capacity, name as zone_name
      FROM zones
      WHERE branch_id = $1 
        AND is_booking_available = TRUE
        AND capacity >= $2
      ORDER BY capacity ASC
    `, [branchId, participants]);

    if (zonesResult.rows.length === 0) {
      console.warn('[available-times] No zones with sufficient capacity:', participants);
      return res.json({ slots: [] });
    }

    // console.log('[available-times] Found zones:', zonesResult.rows.length);

    // Получаем все существующие бронирования на эту дату для всех зон
    // console.log('[available-times] Fetching existing bookings...');
    const bookingsResult = await pool.query(`
      SELECT a.start_time, a.end_time, a.participants_count, az.zone_id
      FROM appointments a
      INNER JOIN appointment_zones az ON a.id = az.appointment_id
      WHERE a.branch_id = $1 
        AND DATE((a.start_time AT TIME ZONE 'UTC') AT TIME ZONE $3) = $2
        AND a.status NOT IN ('cancelled', 'rejected')
      ORDER BY a.start_time
    `, [branchId, date, branchTimezone]);

    // console.log('[available-times] Found bookings:', bookingsResult.rows.length);
    // console.log('[available-times] Generating time slots...');

    // Генерируем временные слоты (с 10:00 до 22:00, каждые 30 минут)
    const slots = [];
    const startHour = 10;
    const endHour = 22;
    
    for (let hour = startHour; hour < endHour; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        
        // Проверяем доступность слота - достаточно если хотя бы одна зона свободна
        const slotDateTime = new Date(`${date}T${timeString}:00`);
        let available = false;

        // Проверяем каждую зону
        for (const zone of zonesResult.rows) {
          let currentOccupancy = 0;

          // Подсчитываем занятость конкретной зоны
          for (const booking of bookingsResult.rows) {
            if (booking.zone_id !== zone.zone_id) continue;

            const bookingStart = new Date(booking.start_time);
            const bookingEnd = new Date(booking.end_time);
            
            if (slotDateTime >= bookingStart && slotDateTime < bookingEnd) {
              currentOccupancy += parseInt(booking.participants_count);
            }
          }

          // Если в этой зоне достаточно места, слот доступен
          if (currentOccupancy + parseInt(participants) <= zone.capacity) {
            available = true;
            break; // Достаточно одной свободной зоны
          }
        }

        slots.push({
          time: timeString,
          available
        });
      }
    }

    // console.log('[available-times] Generated slots:', slots.length);
    // console.log('[available-times] Available slots:', slots.filter(s => s.available).length);
    res.json({ slots });
  } catch (error) {
    console.error('[online-booking] /available-times error:', error);
    console.error('[online-booking] Error stack:', error.stack);
    res.status(500).json({ error: 'Ошибка при загрузке доступных времен', details: error.message });
  }
});

// POST /api/online-booking/create - Создать бронирование
router.post('/create', async (req, res) => {
  try {
    const { 
      branchId, 
      zoneId, 
      serviceId, 
      date, 
      time, 
      participants, 
      clientName, 
      clientPhone, 
      clientEmail,
      duration 
    } = req.body;

    // Валидация (zoneId теперь необязательно - будет определен автоматически)
    if (!branchId || !serviceId || !date || !time || !participants || !clientName || !clientPhone) {
      return res.status(400).json({ 
        error: 'Заполните все обязательные поля' 
      });
    }

    // Получаем timezone филиала
    const branchResult = await pool.query(
      'SELECT timezone FROM branches WHERE branch_id = $1',
      [branchId]
    );

    if (branchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Филиал не найден' });
    }

    const branchTimezone = branchResult.rows[0].timezone || 'Asia/Almaty';
    const timezoneOffset = getTimezoneOffsetString(branchTimezone);

    // Проверяем, существует ли клиент с таким телефоном
    let clientResult = await pool.query(
      'SELECT client_id FROM clients WHERE phone = $1 AND branch_id = $2',
      [clientPhone, branchId]
    );

    let clientId;
    if (clientResult.rows.length === 0) {
      // Создаем нового клиента
      const insertClientResult = await pool.query(`
        INSERT INTO clients (branch_id, name, phone, email)
        VALUES ($1, $2, $3, $4)
        RETURNING client_id
      `, [branchId, clientName, clientPhone, clientEmail || null]);
      
      clientId = insertClientResult.rows[0].client_id;
    } else {
      clientId = clientResult.rows[0].client_id;
    }

    // Создаем бронирование с правильным timezone
    // Конвертируем локальное время филиала в UTC для хранения
    const startTime = new Date(`${date}T${time}:00${timezoneOffset}`);
    const endTime = new Date(startTime.getTime() + duration * 60000);

    // Автоматическое определение зоны, если не указана
    let selectedZoneId = zoneId;
    
    if (!selectedZoneId || selectedZoneId === null) {
      // Получаем все зоны для услуги с достаточной вместимостью
      const availableZonesResult = await pool.query(`
        SELECT z.zone_id, z.capacity, z.name
        FROM zones z
        INNER JOIN service_zones sz ON z.zone_id = sz.zone_id
        WHERE sz.service_id = $1
          AND z.branch_id = $2
          AND z.capacity >= $3
        ORDER BY z.capacity ASC
      `, [serviceId, branchId, participants]);

      if (availableZonesResult.rows.length === 0) {
        return res.status(400).json({ 
          error: 'Не найдено подходящих зон для выбранной услуги и количества участников' 
        });
      }

      // Проверяем доступность каждой зоны на выбранное время
      for (const zone of availableZonesResult.rows) {
        const conflictsResult = await pool.query(
          `SELECT a.participants_count
           FROM appointments a
           JOIN appointment_zones az ON az.appointment_id = a.id
           WHERE a.branch_id = $1
             AND az.zone_id = $2
             AND a.start_time < $3
             AND a.end_time > $4
             AND a.status NOT IN ('cancelled', 'rejected')`,
          [branchId, zone.zone_id, endTime, startTime]
        );

        const currentOccupancy = conflictsResult.rows.reduce(
          (sum, row) => sum + parseInt(row.participants_count || 0), 
          0
        );

        // Если в зоне достаточно места, выбираем её
        if (currentOccupancy + parseInt(participants) <= zone.capacity) {
          selectedZoneId = zone.zone_id;
          console.log(`[online-booking] Автоматически выбрана зона: ${zone.name} (ID: ${zone.zone_id})`);
          break;
        }
      }

      // Если не нашли свободную зону
      if (!selectedZoneId) {
        return res.status(400).json({ 
          error: 'Все зоны заняты на выбранное время. Выберите другое время.' 
        });
      }
    }

    // ПРОВЕРКА: доступна ли зона на выбранное время с учетом вместимости
    const zoneInfoResult = await pool.query(
      'SELECT capacity FROM zones WHERE zone_id = $1',
      [selectedZoneId]
    );

    if (zoneInfoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Зона не найдена' });
    }

    const zoneCapacity = zoneInfoResult.rows[0].capacity;

    // Проверяем занятость зоны на выбранное время
    const conflictsResult = await pool.query(
      `SELECT a.participants_count
         FROM appointments a
         JOIN appointment_zones az ON az.appointment_id = a.id
        WHERE a.branch_id = $1
          AND az.zone_id = $2
          AND a.start_time < $3
          AND a.end_time   > $4
          AND a.status NOT IN ('cancelled', 'rejected')`,
      [branchId, selectedZoneId, endTime, startTime]
    );

    // Подсчитываем текущую занятость
    const currentOccupancy = conflictsResult.rows.reduce(
      (sum, row) => sum + parseInt(row.participants_count || 0), 
      0
    );

    // Проверяем, достаточно ли места для новых участников
    if (currentOccupancy + parseInt(participants) > zoneCapacity) {
      return res.status(400).json({ 
        error: `В выбранной зоне недостаточно мест. Доступно: ${zoneCapacity - currentOccupancy} из ${zoneCapacity}. Выберите другое время или зону.` 
      });
    }

    // Получаем цену услуги
    const priceResult = await pool.query(`
      SELECT COALESCE(sp_weekday.price, sp_weekend.price, 0) as price
      FROM services s
      LEFT JOIN service_prices sp_weekday ON s.service_id = sp_weekday.service_id AND sp_weekday.day_type = 'weekday'
      LEFT JOIN service_prices sp_weekend ON s.service_id = sp_weekend.service_id AND sp_weekend.day_type = 'weekend'
      WHERE s.service_id = $1
    `, [serviceId]);

    const servicePrice = priceResult.rows[0]?.price || 0;
    const totalPrice = servicePrice * participants;

    // Генерируем уникальный public_code
    const publicCode = crypto.randomBytes(4).toString('hex');

    const appointmentResult = await pool.query(`
      INSERT INTO appointments 
        (public_code, branch_id, client_id, service_id, start_time, end_time, duration_minutes, participants_count, price, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `, [
      publicCode,
      branchId, 
      clientId, 
      serviceId, 
      startTime, 
      endTime, 
      duration,
      participants, 
      totalPrice,
      'waiting'
    ]);

    const appointmentId = appointmentResult.rows[0].id;

    // Создаем связь с зоной
    await pool.query(`
      INSERT INTO appointment_zones (appointment_id, zone_id)
      VALUES ($1, $2)
    `, [appointmentId, selectedZoneId]);

    res.json({ 
      success: true, 
      appointmentId: appointmentId,
      publicCode: publicCode
    });
  } catch (error) {
    console.error('[online-booking] /create error:', error);
    res.status(500).json({ error: 'Ошибка при создании бронирования' });
  }
});

// GET /api/online-booking/appointment/:publicCode - Получить информацию о записи по публичному коду
router.get('/appointment/:publicCode', async (req, res) => {
  try {
    const { publicCode } = req.params;

    const appointmentResult = await pool.query(`
      SELECT 
        a.id,
        a.public_code,
        a.start_time,
        a.end_time,
        a.duration_minutes,
        a.participants_count,
        a.price,
        a.status,
        a.comment,
        b.branch_name,
        b.address as branch_address,
        b.phone as branch_phone,
        b.timezone as branch_timezone,
        c.name as client_name,
        c.phone as client_phone,
        c.email as client_email,
        s.name as service_name,
        s.duration as service_duration,
        array_agg(z.name) as zone_names
      FROM appointments a
      LEFT JOIN branches b ON a.branch_id = b.branch_id
      LEFT JOIN clients c ON a.client_id = c.client_id
      LEFT JOIN services s ON a.service_id = s.service_id
      LEFT JOIN appointment_zones az ON a.id = az.appointment_id
      LEFT JOIN zones z ON az.zone_id = z.zone_id
      WHERE a.public_code = $1
      GROUP BY a.id, a.public_code, a.start_time, a.end_time, a.duration_minutes, 
               a.participants_count, a.price, a.status, a.comment,
               b.branch_name, b.address, b.phone, b.timezone, c.name, c.phone, c.email,
               s.name, s.duration
    `, [publicCode]);

    if (appointmentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Запись не найдена' });
    }

    res.json({ appointment: appointmentResult.rows[0] });
  } catch (error) {
    console.error('[online-booking] /appointment/:publicCode error:', error);
    res.status(500).json({ error: 'Ошибка при загрузке записи' });
  }
});

module.exports = router;
