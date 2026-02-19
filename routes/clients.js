
const express = require('express');
const router = express.Router();
const pool = require('../db');
const XLSX = require('xlsx');

// DELETE /clients/:id - удалить клиента по id
router.delete('/clients/:id', async (req, res) => {
  const clientId = req.params.id;
  if (!clientId) {
    return res.status(400).json({ error: 'Не указан id клиента' });
  }
  try {
    const result = await pool.query('DELETE FROM clients WHERE client_id = $1 RETURNING client_id', [clientId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Клиент не найден' });
    }
    res.json({ success: true, client_id: clientId });
  } catch (err) {
    console.error('Ошибка при удалении клиента', err);
    res.status(500).json({ error: 'Ошибка при удалении клиента' });
  }
});

// GET /clients - список клиентов (опционально по филиалу ?branchId=)
router.get('/clients', async (req, res) => {
  const branchId = req.query.branchId || req.query.branch_id;
  
  // ВАЖНО: Требуем обязательное указание branchId для безопасности
  // Это предотвращает получение всех клиентов пользователями без доступа к филиалам
  if (!branchId) {
    return res.status(400).json({ 
      error: 'branchId is required',
      message: 'Необходимо указать филиал для получения списка клиентов'
    });
  }
  
  try {
    const result = await pool.query(
      `SELECT client_id, branch_id, name, phone, additional_phone, email, gender,
              birth_date, spent, paid, discount, card, categories,
              first_visit, last_visit, visits_count, comment,
              agreed_to_mailing, agreed_to_personal_data,
              created_at, updated_at
         FROM clients
        WHERE branch_id = $1
        ORDER BY client_id`,
      [branchId]
    );

    res.json(result.rows || []);
  } catch (err) {
    console.error('clients route error', err);
    res.status(500).json({ error: 'Ошибка при получении клиентов' });
  }
});

// POST /clients - создать нового клиента
router.post('/clients', async (req, res) => {
  const {
    branch_id,
    name,
    phone,
    additional_phone,
    email,
    gender,
    birth_date,
    comment,
    agreed_to_mailing,
    agreed_to_personal_data
  } = req.body;

  if (!branch_id || !name) {
    return res.status(400).json({ error: 'branch_id и name обязательны' });
  }

  // Если birth_date пустая строка, делаем null
  const birthDateVal = birth_date && birth_date.trim() ? birth_date : null;
  const now = new Date();

  try {
    const result = await pool.query(
      `INSERT INTO clients (
        branch_id, name, phone, additional_phone, email, gender, birth_date, comment,
        agreed_to_mailing, agreed_to_personal_data, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING client_id, branch_id, name, phone, additional_phone, email, gender, birth_date, comment,
        agreed_to_mailing, agreed_to_personal_data, created_at, updated_at`,
      [
        branch_id, name, phone, additional_phone, email, gender, birthDateVal, comment,
        agreed_to_mailing, agreed_to_personal_data, now, now
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка при создании клиента', err);
    res.status(500).json({ error: 'Ошибка при создании клиента' });
  }
});

// POST /clients/check-phone - проверка существования клиента по номеру телефона
router.post('/clients/check-phone', async (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Номер телефона не указан' });
  }

  try {
    const result = await pool.query(
      `SELECT client_id, name, phone, email, branch_id
       FROM clients
       WHERE phone = $1
       LIMIT 1`,
      [phone]
    );

    if (result.rows.length > 0) {
      res.json({
        exists: true,
        client: result.rows[0]
      });
    } else {
      res.json({
        exists: false,
        client: null
      });
    }
  } catch (err) {
    console.error('Ошибка при проверке клиента по телефону', err);
    res.status(500).json({ error: 'Ошибка при проверке клиента' });
  }
});

// PUT /clients/:id - обновить данные клиента по ID
router.put('/clients/:id', async (req, res) => {
  const clientId = req.params.id;
  const {
    name,
    phone,
    additional_phone,
    email,
    gender,
    birth_date,
    comment,
    agreed_to_mailing,
    agreed_to_personal_data
  } = req.body;

  if (!clientId) {
    return res.status(400).json({ error: 'Не указан id клиента' });
  }

  if (!name) {
    return res.status(400).json({ error: 'Имя клиента обязательно' });
  }

  const birthDateVal = birth_date && birth_date.trim() ? birth_date : null;
  const now = new Date();

  try {
    const result = await pool.query(
      `UPDATE clients
       SET name = $1, phone = $2, additional_phone = $3, email = $4, gender = $5,
           birth_date = $6, comment = $7, agreed_to_mailing = $8,
           agreed_to_personal_data = $9, updated_at = $10
       WHERE client_id = $11
       RETURNING client_id, branch_id, name, phone, additional_phone, email, gender,
                 birth_date, comment, agreed_to_mailing, agreed_to_personal_data,
                 created_at, updated_at`,
      [
        name, phone, additional_phone, email, gender, birthDateVal, comment,
        agreed_to_mailing, agreed_to_personal_data, now, clientId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Клиент не найден' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка при обновлении клиента', err);
    res.status(500).json({ error: 'Ошибка при обновлении клиента' });
  }
});

// PUT /clients/update - обновление данных клиента по номеру телефона
router.put('/clients/update', async (req, res) => {
  const { phone, name, email } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Номер телефона не указан' });
  }

  try {
    // Обновляем только name и email, если они указаны
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name !== undefined && name !== null) {
      updates.push(`name = $${paramCount}`);
      values.push(name);
      paramCount++;
    }

    if (email !== undefined && email !== null) {
      updates.push(`email = $${paramCount}`);
      values.push(email);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Нет данных для обновления' });
    }

    // Добавляем updated_at
    updates.push(`updated_at = $${paramCount}`);
    values.push(new Date());
    paramCount++;

    // Добавляем phone в конец для WHERE
    values.push(phone);

    const query = `
      UPDATE clients
      SET ${updates.join(', ')}
      WHERE phone = $${paramCount}
      RETURNING client_id, name, phone, email, branch_id, updated_at
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Клиент с таким номером не найден' });
    }

    res.json({
      success: true,
      client: result.rows[0]
    });
  } catch (err) {
    console.error('Ошибка при обновлении клиента', err);
    res.status(500).json({ error: 'Ошибка при обновлении клиента' });
  }
});

// POST /clients/import - импорт клиентов из Excel
router.post('/clients/import', async (req, res) => {
  const client = await pool.connect();
  try {
    const { branchId, clients: clientsData } = req.body;

    if (!branchId || !clientsData || !Array.isArray(clientsData)) {
      return res.status(400).json({ error: 'Invalid request data' });
    }

    // console.log(`Starting import of ${clientsData.length} clients for branch ${branchId}`);

    const duplicates = [];
    const newClients = [];
    let imported = 0;
    let skipped = 0;

    // Начинаем транзакцию для батч-обработки
    await client.query('BEGIN');

    // Обрабатываем батчами по 50 клиентов для экономии памяти
    const BATCH_SIZE = 50;
    for (let i = 0; i < clientsData.length; i += BATCH_SIZE) {
      const batch = clientsData.slice(i, i + BATCH_SIZE);
      
      for (const clientData of batch) {
        if (!clientData.phone) {
          skipped++;
          continue;
        }

        try {
          // Check for duplicate by phone
          const existingResult = await client.query(
            'SELECT * FROM clients WHERE branch_id = $1 AND phone = $2',
            [branchId, clientData.phone]
          );

          if (existingResult.rows.length > 0) {
            const existing = existingResult.rows[0];
            
            // Check if name or email differs
            const nameDiffers = existing.name !== clientData.name;
            const emailDiffers = existing.email !== (clientData.email || null);

            if (nameDiffers || emailDiffers) {
              duplicates.push({
                existing,
                new: clientData
              });
            } else {
              // Same phone, name, and email - just merge visits and dates
              await client.query(
                `UPDATE clients SET
                  visits_count = COALESCE(visits_count, 0) + $1,
                  spent = COALESCE(spent, 0) + $2,
                  paid = COALESCE(paid, 0) + $3,
                  first_visit = CASE WHEN first_visit IS NULL OR $4::timestamp < first_visit THEN $4::timestamp ELSE first_visit END,
                  last_visit = CASE WHEN last_visit IS NULL OR $5::timestamp > last_visit THEN $5::timestamp ELSE last_visit END
                WHERE client_id = $6`,
                [
                  clientData.visits_count || 0,
                  clientData.spent || 0,
                  clientData.paid || 0,
                  clientData.first_visit || new Date(),
                  clientData.last_visit || new Date(),
                  existing.client_id
                ]
              );
              imported++;
            }
          } else {
            // New client - insert
            await client.query(
              `INSERT INTO clients (
                branch_id, name, phone, email, birth_date, gender, 
                spent, paid, discount, visits_count, first_visit, last_visit, 
                comment, additional_phone, agreed_to_mailing, agreed_to_personal_data
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
              [
                branchId,
                clientData.name || '',
                clientData.phone,
                clientData.email || null,
                clientData.birth_date || null,
                clientData.gender || null,
                clientData.spent || 0,
                clientData.paid || 0,
                clientData.discount || 0,
                clientData.visits_count || 0,
                clientData.first_visit || null,
                clientData.last_visit || null,
                clientData.comment || null,
                clientData.additional_phone || null,
                clientData.agreed_to_mailing || false,
                clientData.agreed_to_data_processing || false
              ]
            );
            imported++;
            newClients.push(clientData);
          }
        } catch (clientErr) {
          console.error(`Error processing client ${clientData.phone}:`, clientErr);
          skipped++;
        }
      }
      
      // Логируем прогресс
      // console.log(`Processed ${Math.min(i + BATCH_SIZE, clientsData.length)} / ${clientsData.length} clients`);
    }

    // Коммитим транзакцию
    await client.query('COMMIT');

    // console.log(`Import completed: ${imported} imported, ${duplicates.length} duplicates, ${skipped} skipped`);

    res.json({ 
      success: true, 
      imported, 
      duplicates,
      newClients,
      skipped
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Import error:', err);
    res.status(500).json({ error: 'Ошибка импорта: ' + err.message });
  } finally {
    client.release();
  }
});

// POST /clients/resolve-duplicate - разрешить конфликт дубликата
router.post('/clients/resolve-duplicate', async (req, res) => {
  try {
    const { action, existing, newData } = req.body;

    if (!action || !existing || !newData) {
      return res.status(400).json({ error: 'Invalid request data' });
    }

    if (action === 'keep_old') {
      // Keep old data but merge visits and amounts
      await pool.query(
        `UPDATE clients SET
          visits_count = COALESCE(visits_count, 0) + $1,
          spent = COALESCE(spent, 0) + $2,
          paid = COALESCE(paid, 0) + $3,
          first_visit = CASE WHEN first_visit IS NULL OR $4::timestamp < first_visit THEN $4::timestamp ELSE first_visit END,
          last_visit = CASE WHEN last_visit IS NULL OR $5::timestamp > last_visit THEN $5::timestamp ELSE last_visit END
        WHERE client_id = $6`,
        [
          newData.visits_count || 0,
          newData.spent || 0,
          newData.paid || 0,
          newData.first_visit || new Date(),
          newData.last_visit || new Date(),
          existing.client_id
        ]
      );
    } else if (action === 'update_new') {
      // Update with new data
      await pool.query(
        `UPDATE clients SET
          name = $1,
          email = $2,
          visits_count = COALESCE(visits_count, 0) + $3,
          spent = COALESCE(spent, 0) + $4,
          paid = COALESCE(paid, 0) + $5,
          birth_date = COALESCE($6, birth_date),
          gender = COALESCE($7, gender),
          discount = COALESCE($8, discount),
          comment = COALESCE($9, comment),
          additional_phone = COALESCE($10, additional_phone),
          first_visit = CASE WHEN first_visit IS NULL OR $11::timestamp < first_visit THEN $11::timestamp ELSE first_visit END,
          last_visit = CASE WHEN last_visit IS NULL OR $12::timestamp > last_visit THEN $12::timestamp ELSE last_visit END
        WHERE client_id = $13`,
        [
          newData.name,
          newData.email,
          newData.visits_count || 0,
          newData.spent || 0,
          newData.paid || 0,
          newData.birth_date,
          newData.gender,
          newData.discount,
          newData.comment,
          newData.additional_phone,
          newData.first_visit || new Date(),
          newData.last_visit || new Date(),
          existing.client_id
        ]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Resolve duplicate error:', err);
    res.status(500).json({ error: 'Ошибка: ' + err.message });
  }
});

// GET /clients/export?branchId=X - экспорт клиентов в Excel
router.get('/clients/export', async (req, res) => {
  try {
    const branchId = req.query.branchId || req.query.branch_id;

    if (!branchId) {
      return res.status(400).json({ error: 'branchId required' });
    }

    const result = await pool.query(
      `SELECT name, phone, email, categories, birth_date, spent, paid, gender,
              card, discount, last_visit, first_visit, visits_count, comment,
              additional_phone, agreed_to_mailing, agreed_to_personal_data
       FROM clients
       WHERE branch_id = $1
       ORDER BY client_id`,
      [branchId]
    );

    const headers = [
      'Имя',
      'Телефон',
      'Email',
      'Категории',
      'Дата рождения',
      'Потратил, ₸',
      'Оплатил, ₸',
      'Пол',
      'Карта',
      'Скидка',
      'Последний визит',
      'Первый визит',
      'Количество посещений',
      'Комментарий',
      'Дополнительный телефон',
      'Согласен на получение рассылок',
      'Согласен на обработку персональных данных'
    ];

    const rows = result.rows.map(client => [
      client.name || '',
      client.phone || '',
      client.email || '',
      client.categories || '',
      client.birth_date || '',
      client.spent || 0,
      client.paid || 0,
      client.gender || '',
      client.card || '',
      client.discount || 0,
      client.last_visit || '',
      client.first_visit || '',
      client.visits_count || 0,
      client.comment || '',
      client.additional_phone || '',
      client.agreed_to_mailing ? 'Да' : 'Нет',
      client.agreed_to_personal_data ? 'Да' : 'Нет'
    ]);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Клиенты');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=clients_${branchId}_${new Date().toISOString().split('T')[0]}.xlsx`);
    res.send(buffer);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'Ошибка экспорта: ' + err.message });
  }
});

module.exports = router;
