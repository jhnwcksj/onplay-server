const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');

// Middleware для проверки прав доступа (admin/manager)
const checkManagementAccess = async (req, res, next) => {
  try {
    // console.log('Checking management access for user:', req.user);
    
    if (!req.user || !req.user.id) {
      // console.log('Management access denied: No user or user.id in request');
      // console.log('Authorization header:', req.headers.authorization);
      return res.status(401).json({ error: 'Unauthorized', message: 'No valid authentication token' });
    }

    const userResult = await db.query(
      'SELECT role FROM users WHERE id = $1',
      [req.user.id]
    );

    if (!userResult.rows[0]) {
      // console.log('Management access denied: User not found in database, id:', req.user.id);
      return res.status(401).json({ error: 'User not found' });
    }

    const role = userResult.rows[0].role;
    // console.log('User role:', role);
    
    if (role !== 'admin' && role !== 'manager') {
      // console.log('Management access denied: Insufficient permissions');
      return res.status(403).json({ error: 'Доступ запрещен.' });
    }

    req.userRole = role;
    // console.log('Management access granted for', role);
    next();
  } catch (error) {
    console.error('Management access check error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Получить список всех пользователей
router.get('/users', checkManagementAccess, async (req, res) => {
  try {
    let query;
    let params;
    
    // Если текущий пользователь - admin, показать всех пользователей
    if (req.userRole === 'admin') {
      query = `SELECT id, name, email, phone, role, referred_by, created_at
               FROM users
               ORDER BY role, referred_by NULLS FIRST, created_at DESC`;
      params = [];
    } else {
      // Если текущий пользователь - manager, показать только обычных пользователей (user, vip-user), 
      // которых он пригласил (referred_by = его ID) или referred_by IS NULL
      query = `SELECT id, name, email, phone, role, referred_by, created_at
               FROM users
               WHERE role IN ('user', 'vip-user') AND (referred_by = $1 OR referred_by IS NULL)
               ORDER BY referred_by NULLS FIRST, created_at DESC`;
      params = [req.user.id];
    }
    
    const result = await db.query(query, params);

    res.json({
      users: result.rows,
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Получить детальную информацию о пользователе с его сетями и филиалами
router.get('/users/:id', checkManagementAccess, async (req, res) => {
  try {
    const { id } = req.params;

    // Получить данные пользователя
    const userResult = await db.query(
      `SELECT id, name, email, phone, role, referred_by, created_at
       FROM users
       WHERE id = $1`,
      [id]
    );

    if (!userResult.rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Получить сети пользователя
    const networksResult = await db.query(
      `SELECT DISTINCT n.network_id, n.name, n.slug, n.description
       FROM networks n
       INNER JOIN branches b ON b.network_id = n.network_id
       WHERE b.user_id = $1
       ORDER BY n.name`,
      [id]
    );

    // Получить филиалы пользователя
    const branchesResult = await db.query(
      `SELECT b.branch_id, b.branch_name, b.city, b.address, b.phone, b.timezone,
              b.network_id, b.valid_from, b.valid_until, b.license_status,
              n.name as network_name
       FROM branches b
       LEFT JOIN networks n ON n.network_id = b.network_id
       WHERE b.user_id = $1
       ORDER BY b.branch_name`,
      [id]
    );

    res.json({
      ...user,
      networks: networksResult.rows,
      branches: branchesResult.rows,
    });
  } catch (error) {
    console.error('Get user details error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Создать нового пользователя
router.post('/users', checkManagementAccess, async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      password,
      role = 'user',
      networkId,
      branchId,
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Проверить права на создание пользователя с указанной ролью
    const requesterRole = req.user.role;
    const allowedRoles = {
      admin: ['user', 'vip-user', 'manager'],
      manager: ['user', 'vip-user'],
    };

    if (!allowedRoles[requesterRole] || !allowedRoles[requesterRole].includes(role)) {
      return res.status(403).json({ 
        error: `You don't have permission to create users with role: ${role}` 
      });
    }

    // Проверить, существует ли пользователь с таким email
    const existingUser = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows[0]) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Хешировать пароль
    const hashedPassword = await bcrypt.hash(password, 10);

    // Создать пользователя - используем password вместо password_hash для совместимости
    // referred_by - кто создал этого пользователя
    const userResult = await db.query(
      `INSERT INTO users (name, email, phone, password, role, referred_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING id, name, email, phone, role, referred_by, created_at`,
      [name, email, phone, hashedPassword, role, req.user.id]
    );

    const newUser = userResult.rows[0];

    // Если указан filial, привязать к нему пользователя
    if (branchId) {
      await db.query(
        'UPDATE branches SET user_id = $1 WHERE branch_id = $2',
        [newUser.id, branchId]
      );
    }

    res.status(201).json({
      message: 'User created successfully',
      user: newUser,
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Обновить пользователя
router.put('/users/:id', checkManagementAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      email,
      phone,
      role,
    } = req.body;

    // Проверить, существует ли пользователь
    const existingUser = await db.query(
      'SELECT id, role FROM users WHERE id = $1',
      [id]
    );

    if (!existingUser.rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }

    const requesterRole = req.user.role;
    const targetRole = existingUser.rows[0].role;

    // Проверить права на редактирование пользователя
    // Менеджер не может редактировать менеджеров и администраторов
    if (requesterRole === 'manager' && (targetRole === 'manager' || targetRole === 'admin')) {
      return res.status(403).json({ 
        error: 'Managers cannot edit other managers or administrators' 
      });
    }

    // Администратор не может редактировать администраторов
    if (requesterRole === 'admin' && targetRole === 'admin') {
      return res.status(403).json({ 
        error: 'Administrators cannot edit other administrators' 
      });
    }

    // Проверить права на изменение роли (если роль изменяется)
    if (role && role !== targetRole) {
      const allowedRoles = {
        admin: ['user', 'vip-user', 'manager'],
        manager: ['user', 'vip-user'],
      };

      if (!allowedRoles[requesterRole] || !allowedRoles[requesterRole].includes(role)) {
        return res.status(403).json({ 
          error: `You don't have permission to set role: ${role}` 
        });
      }
    }

    // Обновить пользователя
    const result = await db.query(
      `UPDATE users
       SET name = COALESCE($1, name),
           email = COALESCE($2, email),
           phone = COALESCE($3, phone),
           role = COALESCE($4, role),
           updated_at = NOW()
       WHERE id = $5
       RETURNING id, name, email, phone, role, referred_by, created_at`,
      [name, email, phone, role, id]
    );

    const updatedUser = result.rows[0];

    res.json({
      message: 'User updated successfully',
      user: updatedUser,
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Удалить пользователя
router.delete('/users/:id', checkManagementAccess, async (req, res) => {
  try {
    const { id } = req.params;

    // Только admin может удалять пользователей
    if (req.userRole !== 'admin') {
      return res.status(403).json({ error: 'Only admin can delete users' });
    }

    // Проверить, существует ли пользователь
    const existingUser = await db.query(
      'SELECT id FROM users WHERE id = $1',
      [id]
    );

    if (!existingUser.rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Удалить пользователя
    await db.query('DELETE FROM users WHERE id = $1', [id]);

    res.json({
      message: 'User deleted successfully',
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Создать новую сеть
router.post('/networks', checkManagementAccess, async (req, res) => {
  try {
    const { name, slug, description, userId } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Network name is required' });
    }

    // Создать сеть
    const result = await db.query(
      `INSERT INTO networks (name, slug, description)
       VALUES ($1, $2, $3)
       RETURNING network_id, name, slug, description`,
      [name, slug || name.toLowerCase().replace(/\s+/g, '-'), description]
    );

    res.status(201).json({
      message: 'Network created successfully',
      network: result.rows[0],
    });
  } catch (error) {
    console.error('Create network error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Создать новый филиал
router.post('/branches', checkManagementAccess, async (req, res) => {
  try {
    const {
      networkId,
      branchName,
      city,
      address,
      phone,
      timezone = 'Asia/Almaty',
      userId,
      validFrom,
      validUntil,
      licenseStatus = 'free_trial',
    } = req.body;

    if (!networkId || !branchName) {
      return res.status(400).json({ error: 'Network ID and branch name are required' });
    }

    // Создать филиал
    const result = await db.query(
      `INSERT INTO branches (network_id, branch_name, city, address, phone, timezone, user_id, valid_from, valid_until, license_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING branch_id, network_id, branch_name, city, address, phone, timezone, user_id, valid_from, valid_until, license_status`,
      [networkId, branchName, city, address, phone, timezone, userId || null, validFrom || null, validUntil || null, licenseStatus]
    );

    res.status(201).json({
      message: 'Branch created successfully',
      branch: result.rows[0],
    });
  } catch (error) {
    console.error('Create branch error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Обновить филиал
router.put('/branches/:branchId', checkManagementAccess, async (req, res) => {
  try {
    const { branchId } = req.params;
    const {
      branchName,
      category,
      city,
      address,
      phone,
      timezone,
      validFrom,
      validUntil,
      licenseStatus,
    } = req.body;

    // Проверить, существует ли филиал
    const existingBranch = await db.query(
      'SELECT branch_id FROM branches WHERE branch_id = $1',
      [branchId]
    );

    if (!existingBranch.rows[0]) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    // Обновить филиал
    const result = await db.query(
      `UPDATE branches
       SET branch_name = COALESCE($1, branch_name),
           category = COALESCE($2, category),
           city = COALESCE($3, city),
           address = COALESCE($4, address),
           phone = COALESCE($5, phone),
           timezone = COALESCE($6, timezone),
           valid_from = COALESCE($7, valid_from),
           valid_until = COALESCE($8, valid_until),
           license_status = COALESCE($9, license_status)
       WHERE branch_id = $10
       RETURNING branch_id, network_id, branch_name, category, city, address, phone, timezone, user_id, valid_from, valid_until, license_status`,
      [branchName, category, city, address, phone, timezone, validFrom || null, validUntil || null, licenseStatus, branchId]
    );

    res.json({
      message: 'Branch updated successfully',
      branch: result.rows[0],
    });
  } catch (error) {
    console.error('Update branch error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Привязать пользователя к филиалу
router.put('/branches/:branchId/assign-user', checkManagementAccess, async (req, res) => {
  try {
    const { branchId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Проверить, существует ли филиал
    const branchResult = await db.query(
      'SELECT branch_id FROM branches WHERE branch_id = $1',
      [branchId]
    );

    if (!branchResult.rows[0]) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    // Привязать пользователя
    await db.query(
      'UPDATE branches SET user_id = $1 WHERE branch_id = $2',
      [userId, branchId]
    );

    res.json({
      message: 'User assigned to branch successfully',
    });
  } catch (error) {
    console.error('Assign user to branch error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
