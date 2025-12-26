/**
 * Удаляет все записи истории по appointment_id
 * @param {number} appointment_id
 */
async function deleteAppointmentHistory(appointment_id) {
  if (!appointment_id) return;
  await pool.query('DELETE FROM appointment_history WHERE appointment_id = $1', [appointment_id]);
}

module.exports.deleteAppointmentHistory = deleteAppointmentHistory;
// appointment_history.js
// Хелпер для записи истории изменений записей (appointments)

const pool = require('../db');

/**
 * Логирует действие с записью (appointment) в appointment_history
 * @param {object} clientConn - pg client (транзакция)
 * @param {object} params
 *   - appointment_id: bigint
 *   - action: string (create|update|delete|status_change|service_change|payment)
 *   - user_id: bigint|null
 *   - changes: object|null (JSONB)
 *   - source: string (default 'web')
 */
async function logAppointmentHistory(clientConn, {
  appointment_id,
  action,
  user_id = null,
  changes = null,
  source = 'web',
}) {
  if (!appointment_id || !action) return;
  await clientConn.query(
    `INSERT INTO appointment_history
      (appointment_id, action, user_id, changes, source)
     VALUES ($1, $2, $3, $4, $5)`,
    [appointment_id, action, user_id, changes, source]
  );
}

module.exports = { logAppointmentHistory };
