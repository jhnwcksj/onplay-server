const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /zones - return all zones or zones for a branch (?branchId=)
router.get('/zones', async (req, res) => {
  const branchId = req.query.branchId;
  try {
    let result;

    const baseSelect = `
      SELECT
        z.zone_id,
        z.branch_id,
        z.name,
        z.description,
        z.image_url,
        z.capacity,
        z.zone_type,
        z.can_merge,
        z.is_single_only,
        z.services,
        z.is_booking_available,
        z.working_from,
        z.working_to,
        z.created_at,
        z.updated_at,
        (
          SELECT json_agg(json_build_object('service_id', s.service_id, 'name', s.name) ORDER BY s.name)
          FROM service_zones sz
          JOIN services s ON s.service_id = sz.service_id
          WHERE sz.zone_id = z.zone_id
        ) AS linked_services
      FROM zones z
    `;

    if (branchId) {
      result = await pool.query(baseSelect + ' WHERE z.branch_id = $1 ORDER BY z.zone_id', [branchId]);
    } else {
      result = await pool.query(baseSelect + ' ORDER BY z.zone_id');
    }

    // If no rows found, return empty array (frontend will show a not-found message)
    res.json(result.rows);
  } catch (err) {
    console.error('zones route error', err);
    res.status(500).json({ error: 'Ошибка при получении зон' });
  }
});

// POST /zones - create a new zone
router.post('/zones', async (req, res) => {
  try {
    const {
      branchId,
      branch_id,
      name,
      description,
      image_url,
      capacity,
      zone_type,
      can_merge,
      is_single_only,
      services,
      is_booking_available,
      working_from,
      working_to
    } = req.body || {};

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const finalBranchId = branchId || branch_id;
    if (!finalBranchId) {
      return res.status(400).json({ error: 'branchId is required' });
    }

    let cap = null;
    if (capacity !== undefined && capacity !== null && capacity !== '') {
      const parsed = parseInt(capacity, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        cap = parsed;
      }
    }

    const result = await pool.query(
      `INSERT INTO zones
         (branch_id, name, description, image_url, capacity, zone_type,
          can_merge, is_single_only, services, is_booking_available,
          working_from, working_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        finalBranchId,
        name,
        description || null,
        image_url || null,
        cap,
        zone_type || null,
        can_merge !== false,
        !!is_single_only,
        services || null,
        is_booking_available !== false,
        working_from || null,
        working_to || null
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('zones create error', err);
    res.status(500).json({ error: 'Ошибка при создании зоны' });
  }
});

// PUT /zones/:id - update existing zone
router.put('/zones/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      branchId,
      branch_id,
      name,
      description,
      image_url,
      capacity,
      zone_type,
      can_merge,
      is_single_only,
      services,
      is_booking_available,
      working_from,
      working_to
    } = req.body || {};

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const finalBranchId = branchId || branch_id || null;

    let cap = null;
    if (capacity !== undefined && capacity !== null && capacity !== '') {
      const parsed = parseInt(capacity, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        cap = parsed;
      }
    }

    const result = await pool.query(
      `UPDATE zones
          SET branch_id = COALESCE($1, branch_id),
              name = $2,
              description = $3,
              image_url = $4,
              capacity = $5,
              zone_type = $6,
              can_merge = $7,
              is_single_only = $8,
              services = $9,
              is_booking_available = $10,
              working_from = $11,
              working_to = $12,
              updated_at = NOW()
        WHERE zone_id = $13
        RETURNING *`,
      [
        finalBranchId,
        name,
        description || null,
        image_url || null,
        cap,
        zone_type || null,
        can_merge !== false,
        !!is_single_only,
        services || null,
        is_booking_available !== false,
        working_from || null,
        working_to || null,
        id
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'zone not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('zones update error', err);
    res.status(500).json({ error: 'Ошибка при обновлении зоны' });
  }
});

// DELETE /zones/:id - delete zone and its service links
router.delete('/zones/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('BEGIN');
    await pool.query('DELETE FROM service_zones WHERE zone_id = $1', [id]);
    const result = await pool.query('DELETE FROM zones WHERE zone_id = $1 RETURNING *', [id]);

    if (!result.rows.length) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'zone not found' });
    }

    await pool.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    try { await pool.query('ROLLBACK'); } catch (e) { /* ignore */ }
    console.error('zones delete error', err);
    res.status(500).json({ error: 'Ошибка при удалении зоны' });
  }
});

// PATCH /zones/:id/booking - toggle or set is_booking_available
router.patch('/zones/:id/booking', async (req, res) => {
  try {
    const { id } = req.params;
    let { is_booking_available } = req.body || {};

    if (typeof is_booking_available === 'string') {
      if (is_booking_available === 'true' || is_booking_available === '1') is_booking_available = true;
      else if (is_booking_available === 'false' || is_booking_available === '0') is_booking_available = false;
    }

    if (typeof is_booking_available !== 'boolean') {
      // If not provided, toggle current value
      const current = await pool.query('SELECT is_booking_available FROM zones WHERE zone_id = $1', [id]);
      if (!current.rows.length) {
        return res.status(404).json({ error: 'zone not found' });
      }
      is_booking_available = !current.rows[0].is_booking_available;
    }

    const result = await pool.query(
      'UPDATE zones SET is_booking_available = $1, updated_at = NOW() WHERE zone_id = $2 RETURNING *',
      [!!is_booking_available, id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'zone not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('zones booking patch error', err);
    res.status(500).json({ error: 'Ошибка при обновлении онлайн-записи для зоны' });
  }
});

module.exports = router;
