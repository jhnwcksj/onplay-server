
const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /dashboard/appointment-history?branchId=123
router.get('/appointment-history', async (req, res) => {
  const branchId = req.query.branchId;
  if (!branchId) return res.status(400).json({ error: 'branchId required' });
  try {
    // Получаем историю только по записям этого филиала
    const result = await pool.query(`
      SELECT h.*, u.name AS user_name, a.start_time, a.service_id, s.name AS service_name, a.client_id, c.name AS client_name
        FROM appointment_history h
        LEFT JOIN users u ON u.id = h.user_id
        LEFT JOIN appointments a ON a.id = h.appointment_id
        LEFT JOIN services s ON s.service_id = a.service_id
        LEFT JOIN clients c ON c.client_id = a.client_id
       WHERE a.branch_id = $1
       ORDER BY h.changed_at DESC
    `, [branchId]);
    res.json({ history: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'DB error', details: err.message });
  }
});

// GET /dashboard/appointments?branchId=123
router.get('/appointments', async (req, res) => {
  const branchId = req.query.branchId;
  if (!branchId) return res.status(400).json({ error: 'branchId required' });
  try {
    // Получаем appointments с JOIN к services и zones (через appointment_zones)
    const result = await pool.query(`
      SELECT a.*, 
             MAX(s.name) AS service_name,
             MAX(s.description) AS service_description,
             MAX(s.duration) AS service_duration,
             COALESCE(array_agg(DISTINCT z.name) FILTER (WHERE z.zone_id IS NOT NULL), ARRAY[]::varchar[]) AS zone_names,
             COALESCE(array_agg(DISTINCT z.zone_id) FILTER (WHERE z.zone_id IS NOT NULL), ARRAY[]::bigint[]) AS zone_ids
        FROM appointments a
        LEFT JOIN services s ON s.service_id = a.service_id
        LEFT JOIN appointment_zones az ON az.appointment_id = a.id
        LEFT JOIN zones z ON z.zone_id = az.zone_id
       WHERE a.branch_id = $1
       GROUP BY a.id
       ORDER BY a.start_time DESC
    `, [branchId]);
    res.json({ appointments: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'DB error', details: err.message });
  }
});

module.exports = router;
