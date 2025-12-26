const express = require('express');
const router = express.Router();
const pool = require('../db');

// Получить все категории услуг (с фильтром по филиалу)
router.get('/', async (req, res) => {
  try {
    const branch_id = req.query.branch_id;
    let query = 'SELECT * FROM service_categories';
    let params = [];
    if (branch_id) {
      query += ' WHERE branch_id = $1';
      params.push(branch_id);
    }
    const result = await pool.query(query, params);
    res.json({ categories: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
