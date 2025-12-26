
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { logAppointmentHistory } = require('./appointment_history');

// Получить записи по услуге (и опционально филиалу)
// GET /appointments?service_id=... - ищет по service_id и по services (JSONB в appointment_meta.extra)
router.get('/appointments', async (req, res) => {
  const { service_id, branch_id } = req.query;
  if (!service_id) return res.status(400).json({ error: 'service_id required' });
  // Debug: логируем входящий service_id и его тип
  // console.log('[GET /appointments] service_id:', service_id, 'typeof:', typeof service_id);
  try {
    // Только поиск по appointments.service_id
    let query = 'SELECT * FROM appointments WHERE service_id = $1 AND client_id IS NOT NULL';
    let params = [Number(service_id)];
    if (branch_id) {
      query += ' AND branch_id = $2';
      params.push(branch_id);
    }
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// Пересчитать first_visit, last_visit и visits_count клиента
async function recalcClientVisits(clientConn, clientId) {
  if (!clientId) return;

  const agg = await clientConn.query(
    `SELECT MIN(start_time) AS first_visit,
            MAX(start_time) AS last_visit,
            COUNT(*)::int    AS visits_count
       FROM appointments
      WHERE client_id = $1
        AND status IN ('arrived','confirmed')`,
    [clientId]
  );

  if (!agg.rows || agg.rows.length === 0) return;

  const { first_visit, last_visit, visits_count } = agg.rows[0];

  await clientConn.query(
    `UPDATE clients
        SET first_visit = $2,
            last_visit  = $3,
            visits_count = COALESCE($4, visits_count)
      WHERE client_id = $1`,
    [clientId, first_visit || null, last_visit || null, visits_count || null]
  );
}

// POST /appointments - создать новую запись

router.post('/appointments', async (req, res) => {
  try {
    // Debug: логируем тело запроса для отладки
    // console.log('[POST /appointments] req.body:', req.body);
    const {
      branch_id,
      zone_ids,
      start_time,    // ISO-строка TIMESTAMPTZ
      end_time,      // ISO-строка TIMESTAMPTZ
      service_id,
      participants,
      quantity,
      final_price,
      prepaid,
      discount,
      comment,
      status,
      client,
      services,
      color,
      is_paid,
      payment_method,
    } = req.body || {};

    if (!branch_id || !Array.isArray(zone_ids) || zone_ids.length === 0) {
      return res.status(400).json({ error: 'branch_id и zone_ids обязательны' });
    }
    if (!start_time || !end_time) {
      return res.status(400).json({ error: 'start_time и end_time обязательны (TIMESTAMPTZ)' });
    }
    // Поддерживаем старый формат (одна услуга через service_id)
    // и новый формат (массив services). Должно быть указано хотя бы что-то одно.
    if (!service_id && (!Array.isArray(services) || services.length === 0)) {
      return res.status(400).json({ error: 'service_id или services обязательны' });
    }

    const startDateTime = new Date(start_time);
    const endDateTime = new Date(end_time);
    if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
      return res.status(400).json({ error: 'Неверный формат start_time или end_time' });
    }
    const durationMinutes = Math.max(1, Math.round((endDateTime.getTime() - startDateTime.getTime()) / 60000));

    // Базовые значения для старого формата (одна услуга)
    let participantsCount = Number(participants) || 1;
    let qty = Number(quantity) || 1;
    let finalPriceTotal = Number(final_price) || 0;      // сумма к оплате после скидки, ДО предоплаты
    let prepaidTotal = Number(prepaid) || 0;             // фактически внесённая предоплата
    let discountValue = Number(discount) || 0;           // общая сумма скидки
    let mainServiceId = service_id || null;
    let servicesPayload = null;

    // Если передан новый формат с массивом услуг, считаем агрегаты по нему
    if (Array.isArray(services) && services.length > 0) {
      servicesPayload = services
        .map((s) => {
          if (!s || !s.service_id) return null;
          const sQty = Number(s.quantity) || 1;
          const sParticipants = Number(s.participants) || 1;
          const sFinal = Number(s.final_price) || 0;
          const sPrepaid = Number(s.prepaid) || 0;
          const sDiscount = Number(s.discount) || 0;
          return {
            service_id: s.service_id,
            quantity: sQty,
            participants: sParticipants,
            final_price: sFinal,
            prepaid: sPrepaid,
            discount: sDiscount,
          };
        })
        .filter(Boolean);

      if (servicesPayload.length === 0) {
        return res.status(400).json({ error: 'Некорректный формат services' });
      }

      mainServiceId = servicesPayload[0].service_id;

      finalPriceTotal = servicesPayload.reduce((sum, s) => sum + s.final_price, 0);
      prepaidTotal = servicesPayload.reduce((sum, s) => sum + s.prepaid, 0);
      discountValue = servicesPayload.reduce((sum, s) => sum + s.discount, 0);
      qty = servicesPayload.reduce((sum, s) => sum + s.quantity, 0) || 1;
      participantsCount = servicesPayload.reduce((max, s) => Math.max(max, s.participants), 1);
    }

    // Полная стоимость ДО скидки и предоплаты
    const fullPrice = finalPriceTotal + discountValue;

    // В колонку prepayment пишем только фактическую предоплату,
    // чтобы balance (price - prepayment) = сумма после скидки - предоплата
    const prepaymentDb = prepaidTotal;

    const publicCode = Math.random().toString(36).substring(2, 10).toUpperCase();

    

    const clientConn = await pool.connect();
    try {
      await clientConn.query('BEGIN');

      // --- Клиент: ищем по номеру телефона, при отсутствии создаём ---
      let clientId = null;
      let clientCreated = false;
      let clientFound = false;
      if (client && (client.phone || client.email)) {
        const name = (client.name || '').trim() || 'Без имени';
        const phoneRaw = (client.phone || '').trim() || null;
        const phone = phoneRaw ? phoneRaw.replace(/[^0-9]/g, '') : null;
        const email = (client.email || '').trim() || null;

        // Пытаемся найти существующего клиента:
        let findRes;
        if (phone) {
          findRes = await clientConn.query(
            `SELECT client_id FROM clients WHERE branch_id = $1 AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = $2 ORDER BY client_id LIMIT 1`,
            [branch_id, phone]
          );
        } else if (email) {
          findRes = await clientConn.query(
            `SELECT client_id FROM clients WHERE branch_id = $1 AND email = $2 ORDER BY client_id LIMIT 1`,
            [branch_id, email]
          );
        } else {
          findRes = { rows: [] };
        }

        if (findRes.rows.length > 0) {
          clientId = findRes.rows[0].client_id;
          clientFound = true;
        } else {
          // Создаём нового клиента
          const insertClient = await clientConn.query(
            `INSERT INTO clients (branch_id, name, phone, email)
             VALUES ($1,$2,$3,$4)
             RETURNING client_id`,
            [branch_id, name, phone, email]
          );
          clientId = insertClient.rows[0].client_id;
          clientCreated = true;
        }
      }

      // --- Обновляем paid и spent, если оплата картой или наличными ---
      if (clientId && typeof is_paid === 'boolean' && is_paid && ['card','cash'].includes(payment_method)) {
        await clientConn.query(
          `UPDATE clients SET paid = COALESCE(paid,0) + $1, spent = COALESCE(spent,0) + $1 WHERE client_id = $2`,
          [Number(finalPriceTotal) || 0, clientId]
        );
      }

      const insertRes = await clientConn.query(
        `INSERT INTO appointments (
           public_code,
           branch_id,
           client_id,
           created_by,
           parent_appointment_id,
           start_time,
           end_time,
           duration_minutes,
           participants_count,
           service_id,
           price,
           status,
           is_paid,
           payment_method,
           prepayment,
           comment
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id, client_id, status`,
        [
          publicCode,
          branch_id,
          clientId,          // client_id, если найден/создан клиент
          null,              // created_by
          null,              // parent_appointment_id
          startDateTime,
          endDateTime,
          durationMinutes,
          participantsCount,
          mainServiceId,
          finalPriceTotal,
          status || 'waiting',
          typeof is_paid === 'boolean' ? is_paid : false,
          ['card','cash'].includes(payment_method) ? payment_method : null,
          prepaymentDb,
          comment || null,
        ]
      );

      const appointmentRow = insertRes.rows[0];
      const appointmentId = appointmentRow.id;

      // Связи с зонами
      for (const zid of zone_ids) {
        await clientConn.query(
          'INSERT INTO appointment_zones (appointment_id, zone_id) VALUES ($1,$2)',
          [appointmentId, zid]
        );
      }

      // Доп. данные (клиент, скидки и т.п.)
      const extra = {
        client: client || null,
        quantity: qty,
        discount: discountValue,                 // сумма скидки
        prepaid: prepaidTotal,                   // фактическая предоплата
        full_price: fullPrice,                   // полная стоимость до скидки и предоплаты
        final_price: finalPriceTotal - prepaidTotal, // остаток к оплате на момент создания
        // При новом формате сюда кладём подробный список услуг
        services: servicesPayload,
      };

      // По умолчанию цвет берём #e0f9f3, если не передан явно
      const metaColor = color || '#e0f9f3';

      // category и extra могут быть пустыми
      await clientConn.query(
        'INSERT INTO appointment_meta (appointment_id, color, category, extra) VALUES ($1,$2,$3,$4)',
        [appointmentId, metaColor, null, extra]
      );

      // Обновляем даты первого и последнего визита клиента, если он есть
      await recalcClientVisits(clientConn, appointmentRow.client_id);


      // Логируем создание в appointment_history
      await logAppointmentHistory(clientConn, {
        appointment_id: appointmentId,
        action: 'create',
        user_id: req.user && req.user.id ? req.user.id : null,
        changes: { after: req.body },
        source: 'web',
      });

      await clientConn.query('COMMIT');

      res.json({
        appointment_id: appointmentId,
        public_code: publicCode,
        client_id: clientId,
        client_found: clientFound,
        client_created: clientCreated,
      });
    } catch (err) {
      await clientConn.query('ROLLBACK');
      console.error('create appointment error', err);
      res.status(500).json({ error: 'Ошибка при создании записи' });
    } finally {
      clientConn.release();
    }
  } catch (err) {
    console.error('appointments route error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /appointments/:id - обновить существующую запись
router.put('/appointments/:id', async (req, res) => {
  try {
    const appointmentId = Number(req.params.id);
    if (!appointmentId) {
      return res.status(400).json({ error: 'Некорректный id записи' });
    }

    const {
      branch_id,
      zone_ids,
      start_time,    // ISO-строка TIMESTAMPTZ
      end_time,      // ISO-строка TIMESTAMPTZ
      service_id,
      participants,
      quantity,
      final_price,
      prepaid,
      discount,
      comment,
      status,
      client,
      // Новый формат: массив услуг
      services,
      color,
      is_paid,
      payment_method,
    } = req.body || {};

    if (!branch_id || !Array.isArray(zone_ids) || zone_ids.length === 0) {
      return res.status(400).json({ error: 'branch_id и zone_ids обязательны' });
    }
    if (!start_time || !end_time) {
      return res.status(400).json({ error: 'start_time и end_time обязательны (TIMESTAMPTZ)' });
    }
    // Поддерживаем старый формат (одна услуга через service_id)
    // и новый формат (массив services). Должно быть указано хотя бы что-то одно.
    if (!service_id && (!Array.isArray(services) || services.length === 0)) {
      return res.status(400).json({ error: 'service_id или services обязательны' });
    }

    const startDateTime = new Date(start_time);
    const endDateTime = new Date(end_time);

    if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
      return res.status(400).json({ error: 'Неверный формат start_time или end_time' });
    }

    const durationMinutes = Math.max(1, Math.round((endDateTime.getTime() - startDateTime.getTime()) / 60000));

    // Базовые значения для старого формата (одна услуга)
    let participantsCount = Number(participants) || 1;
    let qty = Number(quantity) || 1;
    let finalPriceTotal = Number(final_price) || 0;      // сумма к оплате после скидки, ДО предоплаты
    let prepaidTotal = Number(prepaid) || 0;             // фактически внесённая предоплата
    let discountValue = Number(discount) || 0;           // общая сумма скидки
    let mainServiceId = service_id || null;
    let servicesPayload = null;

    // Если передан новый формат с массивом услуг, считаем агрегаты по нему
    if (Array.isArray(services) && services.length > 0) {
      servicesPayload = services
        .map((s) => {
          if (!s || !s.service_id) return null;
          const sQty = Number(s.quantity) || 1;
          const sParticipants = Number(s.participants) || 1;
          const sFinal = Number(s.final_price) || 0;
          const sPrepaid = Number(s.prepaid) || 0;
          const sDiscount = Number(s.discount) || 0;
          return {
            service_id: s.service_id,
            quantity: sQty,
            participants: sParticipants,
            final_price: sFinal,
            prepaid: sPrepaid,
            discount: sDiscount,
          };
        })
        .filter(Boolean);

      if (servicesPayload.length === 0) {
        return res.status(400).json({ error: 'Некорректный формат services' });
      }

      mainServiceId = servicesPayload[0].service_id;

      finalPriceTotal = servicesPayload.reduce((sum, s) => sum + s.final_price, 0);
      prepaidTotal = servicesPayload.reduce((sum, s) => sum + s.prepaid, 0);
      discountValue = servicesPayload.reduce((sum, s) => sum + s.discount, 0);
      qty = servicesPayload.reduce((sum, s) => sum + s.quantity, 0) || 1;
      participantsCount = servicesPayload.reduce((max, s) => Math.max(max, s.participants), 1);
    }

    const fullPrice = finalPriceTotal + discountValue;
    const prepaymentDb = prepaidTotal;

    const clientConn = await pool.connect();
    try {
      await clientConn.query('BEGIN');

      // Проверяем, что запись существует и принадлежит филиалу
      const currentAppt = await clientConn.query(
        'SELECT id, branch_id, client_id, is_paid, payment_method, price FROM appointments WHERE id = $1',
        [appointmentId]
      );
      if (currentAppt.rows.length === 0) {
        await clientConn.query('ROLLBACK');
        return res.status(404).json({ error: 'Запись не найдена' });
      }
      if (Number(currentAppt.rows[0].branch_id) !== Number(branch_id)) {
        await clientConn.query('ROLLBACK');
        return res.status(400).json({ error: 'Нельзя изменить запись другого филиала' });
      }

      // --- Клиент: та же логика поиска/создания, что и в POST ---
      let clientId = currentAppt.rows[0].client_id || null;
      let clientCreated = false;
      let clientFound = false;
      if (client && (client.phone || client.email)) {
        const name = (client.name || '').trim() || 'Без имени';
        const phoneRaw = (client.phone || '').trim() || null;
        const phone = phoneRaw ? phoneRaw.replace(/[^0-9]/g, '') : null;
        const email = (client.email || '').trim() || null;

        let findRes;
        if (phone) {
          findRes = await clientConn.query(
            `SELECT client_id FROM clients WHERE branch_id = $1 AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = $2 ORDER BY client_id LIMIT 1`,
            [branch_id, phone]
          );
        } else if (email) {
          findRes = await clientConn.query(
            `SELECT client_id FROM clients WHERE branch_id = $1 AND email = $2 ORDER BY client_id LIMIT 1`,
            [branch_id, email]
          );
        } else {
          findRes = { rows: [] };
        }

        if (findRes.rows.length > 0) {
          clientId = findRes.rows[0].client_id;
          clientFound = true;
        } else {
          const insertClient = await clientConn.query(
            `INSERT INTO clients (branch_id, name, phone, email)
             VALUES ($1,$2,$3,$4)
             RETURNING client_id`,
            [branch_id, name, phone, email]
          );
          clientId = insertClient.rows[0].client_id;
          clientCreated = true;
        }
      }

      // --- Обновляем paid и spent, если оплата картой или наличными, только если статус оплаты изменился ---
      // Получаем старые значения
      const prevPaid = currentAppt.rows[0].is_paid;
      const prevMethod = currentAppt.rows[0].payment_method;
      const prevPrice = Number(currentAppt.rows[0].price) || 0;
      const newPaid = typeof is_paid === 'boolean' ? is_paid : false;
      const newMethod = payment_method;
      const isPrevCardOrCash = ['card','cash'].includes(prevMethod);
      const isNewCardOrCash = ['card','cash'].includes(newMethod);

      // Если раньше не было оплаты (или не card/cash), а теперь есть — начисляем сумму
      if (clientId && !prevPaid && newPaid && isNewCardOrCash) {
        await clientConn.query(
          `UPDATE clients SET paid = COALESCE(paid,0) + $1, spent = COALESCE(spent,0) + $1 WHERE client_id = $2`,
          [Number(finalPriceTotal) || 0, clientId]
        );
      }
      // Если раньше была оплата card/cash, а теперь отменили или сменили на не card/cash — вычитаем сумму
      else if (clientId && prevPaid && isPrevCardOrCash && (!newPaid || !isNewCardOrCash)) {
        await clientConn.query(
          `UPDATE clients SET paid = COALESCE(paid,0) - $1, spent = COALESCE(spent,0) - $1 WHERE client_id = $2`,
          [prevPrice, clientId]
        );
      }
      // Если была оплата card/cash и осталась card/cash, но сумма изменилась — корректируем на разницу
      else if (clientId && prevPaid && isPrevCardOrCash && newPaid && isNewCardOrCash && Number(finalPriceTotal) !== prevPrice) {
        const diff = Number(finalPriceTotal) - prevPrice;
        if (diff !== 0) {
          await clientConn.query(
            `UPDATE clients SET paid = COALESCE(paid,0) + $1, spent = COALESCE(spent,0) + $1 WHERE client_id = $2`,
            [diff, clientId]
          );
        }
      }

      const updateRes = await clientConn.query(
        `UPDATE appointments
            SET client_id = COALESCE($1, client_id),
                start_time = $2,
                end_time = $3,
                duration_minutes = $4,
                participants_count = $5,
                service_id = $6,
                price = $7,
                status = $8,
                prepayment = $9,
                comment = $10,
                is_paid = $11,
                payment_method = $12
          WHERE id = $13
        RETURNING client_id, status`,
        [
          clientId,
          startDateTime,
          endDateTime,
          durationMinutes,
          participantsCount,
          mainServiceId,
          finalPriceTotal,
          status || 'waiting',
          prepaymentDb,
          comment || null,
          typeof is_paid === 'boolean' ? is_paid : false,
          ['card','cash'].includes(payment_method) ? payment_method : null,
          appointmentId,
        ]
      );

      const updatedAppt = updateRes.rows[0];

      // Обновляем связи с зонами: удаляем старые и вставляем новые
      await clientConn.query(
        'DELETE FROM appointment_zones WHERE appointment_id = $1',
        [appointmentId]
      );
      for (const zid of zone_ids) {
        await clientConn.query(
          'INSERT INTO appointment_zones (appointment_id, zone_id) VALUES ($1,$2)',
          [appointmentId, zid]
        );
      }

      const extra = {
        client: client || null,
        quantity: qty,
        discount: discountValue,
        prepaid: prepaidTotal,
        full_price: fullPrice,
        final_price: finalPriceTotal - prepaidTotal,
        services: servicesPayload,
      };

      // Обновляем appointment_meta, сохраняя цвет/категорию если есть
      const metaRes = await clientConn.query(
        'SELECT color, category FROM appointment_meta WHERE appointment_id = $1',
        [appointmentId]
      );
      if (metaRes.rows.length > 0) {
        const currentColor = metaRes.rows[0].color || '#e0f9f3';
        const newColor = color || currentColor;
        await clientConn.query(
          'UPDATE appointment_meta SET color = $1, extra = $2 WHERE appointment_id = $3',
          [newColor, extra, appointmentId]
        );
      } else {
        const insertColor = color || '#e0f9f3';
        await clientConn.query(
          'INSERT INTO appointment_meta (appointment_id, color, category, extra) VALUES ($1,$2,$3,$4)',
          [appointmentId, insertColor, null, extra]
        );
      }

      // Обновляем даты первого и последнего визита клиента, если он есть
      await recalcClientVisits(clientConn, updatedAppt.client_id);


      // Логируем обновление в appointment_history
      await logAppointmentHistory(clientConn, {
        appointment_id: appointmentId,
        action: 'update',
        user_id: req.user && req.user.id ? req.user.id : null,
        changes: {
          before: currentAppt.rows[0],
          after: req.body
        },
        source: 'web',
      });

      await clientConn.query('COMMIT');

      res.json({
        appointment_id: appointmentId,
        client_id: clientId,
        client_found: clientFound,
        client_created: clientCreated,
      });
    } catch (err) {
      await clientConn.query('ROLLBACK');
      console.error('update appointment error', err);
      res.status(500).json({ error: 'Ошибка при обновлении записи' });
    } finally {
      clientConn.release();
    }
  } catch (err) {
    console.error('appointments update route error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /appointments/:id - удалить существующую запись
// POST /appointments/:id/pay - отметить оплату
router.post('/appointments/:id/pay', async (req, res) => {
  try {
    const appointmentId = Number(req.params.id);
    if (!appointmentId) {
      return res.status(400).json({ error: 'Некорректный id записи' });
    }
    const { is_paid, payment_method } = req.body || {};
    if (typeof is_paid !== 'boolean' || !['card','cash'].includes(payment_method)) {
      return res.status(400).json({ error: 'Некорректные параметры оплаты' });
    }
    const clientConn = await pool.connect();
    try {
      await clientConn.query('BEGIN');
      const updateRes = await clientConn.query(
        'UPDATE appointments SET is_paid = $1, payment_method = $2 WHERE id = $3 RETURNING id, is_paid, payment_method',
        [is_paid, payment_method, appointmentId]
      );
      await clientConn.query('COMMIT');
      if (updateRes.rowCount === 0) {
        return res.status(404).json({ error: 'Запись не найдена' });
      }
      res.json({ success: true, appointment_id: appointmentId, is_paid, payment_method });
    } catch (err) {
      await clientConn.query('ROLLBACK');
      console.error('pay appointment error', err);
      res.status(500).json({ error: 'Ошибка при оплате' });
    } finally {
      clientConn.release();
    }
  } catch (err) {
    console.error('appointments pay route error', err);
    res.status(500).json({ error: 'Server error' });
  }
});
router.delete('/appointments/:id', async (req, res) => {
  try {
    const appointmentId = Number(req.params.id);
    if (!appointmentId) {
      return res.status(400).json({ error: 'Некорректный id записи' });
    }

    const clientConn = await pool.connect();
    try {
      await clientConn.query('BEGIN');

      // Получаем данные для истории до удаления
      const prevApptRes = await clientConn.query(
        'SELECT * FROM appointments WHERE id = $1',
        [appointmentId]
      );
      const prevAppt = prevApptRes.rows[0] || null;


      // Сначала логируем удаление (пока appointment ещё существует)
      await logAppointmentHistory(clientConn, {
        appointment_id: appointmentId,
        action: 'delete',
        user_id: req.user && req.user.id ? req.user.id : null,
        changes: { before: prevAppt },
        source: 'web',
      });

      // Затем удаляем связанные данные (мета и зоны), потом саму запись
      await clientConn.query(
        'DELETE FROM appointment_meta WHERE appointment_id = $1',
        [appointmentId]
      );
      await clientConn.query(
        'DELETE FROM appointment_zones WHERE appointment_id = $1',
        [appointmentId]
      );

      const delRes = await clientConn.query(
        'DELETE FROM appointments WHERE id = $1 RETURNING id',
        [appointmentId]
      );

      await clientConn.query('COMMIT');

      if (delRes.rowCount === 0) {
        return res.status(404).json({ error: 'Запись не найдена' });
      }

      res.json({ success: true, appointment_id: appointmentId });
    } catch (err) {
      await clientConn.query('ROLLBACK');
      console.error('delete appointment error', err);
      res.status(500).json({ error: 'Ошибка при удалении записи' });
    } finally {
      clientConn.release();
    }
  } catch (err) {
    console.error('appointments delete route error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /appointments/check - проверить доступность зон на указанное время
router.post('/appointments/check', async (req, res) => {
  try {
    const {
      branch_id,
      zone_ids,
      start_time, // ISO-строка TIMESTAMPTZ
      end_time,   // ISO-строка TIMESTAMPTZ
      appointment_id,
    } = req.body || {};

    if (!branch_id || !Array.isArray(zone_ids) || zone_ids.length === 0) {
      return res.status(400).json({ error: 'branch_id и zone_ids обязательны' });
    }
    if (!start_time || !end_time) {
      return res.status(400).json({ error: 'start_time и end_time обязательны (TIMESTAMPTZ)' });
    }

    const startDateTime = new Date(start_time);
    const endDateTime = new Date(end_time);
    if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
      return res.status(400).json({ error: 'Неверный формат start_time или end_time' });
    }

    // Ищем пересечения по времени в тех же зонах этого филиала
    const result = await pool.query(
      `SELECT a.id,
              a.start_time,
              a.end_time,
              array_agg(DISTINCT az.zone_id) AS zone_ids
         FROM appointments a
         JOIN appointment_zones az ON az.appointment_id = a.id
        WHERE a.branch_id = $1
          AND az.zone_id = ANY($2::bigint[])
          AND a.start_time < $3
          AND a.end_time   > $4
          AND ($5::bigint IS NULL OR a.id <> $5::bigint)
        GROUP BY a.id, a.start_time, a.end_time
        ORDER BY a.start_time`,
      [branch_id, zone_ids, endDateTime, startDateTime, appointment_id || null]
    );

    const conflicts = result.rows || [];
    const available = conflicts.length === 0;

    res.json({ available, conflicts });
  } catch (err) {
    console.error('appointments check error', err);
    res.status(500).json({ error: 'Server error' });
  }
});



module.exports = router;
