
const express = require('express');
const router = express.Router();
const pool = require('../db');

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
  const branchId = req.query.branchId;
  try {
    let result;
    if (branchId) {
      result = await pool.query(
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
    } else {
      result = await pool.query(
        `SELECT client_id, branch_id, name, phone, additional_phone, email, gender,
                birth_date, spent, paid, discount, card, categories,
                first_visit, last_visit, visits_count, comment,
                agreed_to_mailing, agreed_to_personal_data,
                created_at, updated_at
           FROM clients
          ORDER BY client_id`
      );
    }

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

module.exports = router;
