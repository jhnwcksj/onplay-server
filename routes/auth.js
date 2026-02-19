const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");
require('dotenv').config();

const AUTH_SECRET = process.env.SECRET_KEY;

function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : header;
    if (!token) return res.status(401).json({ error: "Токен отсутствует" });

    const decoded = jwt.verify(token, AUTH_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Неверный или просроченный токен" });
  }
}

// register
router.post("/register", async (req, res) => {
  const { name, email, password, phone } = req.body;

  // Валидация
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Имя, почта и пароль обязательны" });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: "Пароль должен быть не менее 6 символов" });
  }

  // Получаем IP адрес пользователя
  const reg_ip = req.headers['x-forwarded-for'] || 
                 req.headers['x-real-ip'] || 
                 req.connection.remoteAddress || 
                 req.socket.remoteAddress ||
                 (req.connection.socket ? req.connection.socket.remoteAddress : null);

  try {
    // Проверяем, существует ли пользователь с таким email
    const existingUser = await pool.query(
      "SELECT id FROM users WHERE email=$1",
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: "Пользователь с таким email уже существует" });
    }

    // Хешируем пароль
    const hashedPassword = await bcrypt.hash(password, 10);

    // Создаем нового пользователя
    const result = await pool.query(
      `INSERT INTO users (name, email, password, phone, reg_ip, role, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, 'user', NOW(), NOW()) 
       RETURNING *`,
      [name, email, hashedPassword, phone || null, reg_ip]
    );

    const user = result.rows[0];

    // Генерируем токен
    const token = jwt.sign(
      { id: user.id, journal_id: user.journal_id, role: user.role },
      AUTH_SECRET,
      { expiresIn: "7d" }
    );

    // Обновляем токен в базе
    await pool.query(
      "UPDATE users SET token=$1, updated_at=NOW() WHERE id=$2",
      [token, user.id]
    );

    // Возвращаем данные пользователя
    res.status(201).json({
      message: "Регистрация успешна",
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        journal_id: user.journal_id,
        avatar: user.avatar,
        phone: user.phone,
        email_confirmed: user.email_confirmed,
        phone_confirmed: user.phone_confirmed
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка при регистрации" });
  }
});

// login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    // ищем пользователя по email
    const result = await pool.query(
      "SELECT * FROM users WHERE email=$1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Пользователь не найден" });
    }

    const user = result.rows[0];

    // проверка пароля
    const isCorrect = await bcrypt.compare(password, user.password);
    if (!isCorrect) {
      return res.status(400).json({ error: "Неверный пароль" });
    }

    // генерируем токен (JWT)
    const token = jwt.sign(
      { id: user.id, journal_id: user.journal_id, role: user.role },
      AUTH_SECRET,
      { expiresIn: "7d" }
    );

    // обновим токен в базе (опционально)
    await pool.query(
      "UPDATE users SET token=$1, updated_at=NOW() WHERE id=$2",
      [token, user.id]
    );

    // возвращаем фронтенду
    res.json({
      message: "Успешная авторизация",
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        journal_id: user.journal_id,
        avatar: user.avatar,
        phone: user.phone,
        email_confirmed: user.email_confirmed,
        phone_confirmed: user.phone_confirmed
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// Текущий пользователь (профиль)
router.get("/me", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query("SELECT * FROM users WHERE id=$1", [userId]);
    if (!result.rows.length) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }
    const user = result.rows[0];
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        journal_id: user.journal_id,
        avatar: user.avatar,
        phone: user.phone,
        email_confirmed: user.email_confirmed,
        phone_confirmed: user.phone_confirmed
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// Обновление базовых данных профиля (имя / телефон)
router.put("/me", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { name, phone } = req.body || {};

  const fields = [];
  const values = [];
  let i = 1;

  if (name !== undefined) {
    fields.push(`name=$${i++}`);
    values.push(name);
  }
  if (phone !== undefined) {
    fields.push(`phone=$${i++}`);
    values.push(phone);
  }

  if (!fields.length) {
    return res.status(400).json({ error: "Нет данных для обновления" });
  }

  values.push(userId);

  const sql = `UPDATE users SET ${fields.join(", ")}, updated_at=NOW() WHERE id=$${i} RETURNING *`;

  try {
    const result = await pool.query(sql, values);
    const user = result.rows[0];
    res.json({
      message: "Данные обновлены",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        journal_id: user.journal_id,
        avatar: user.avatar,
        phone: user.phone,
        email_confirmed: user.email_confirmed,
        phone_confirmed: user.phone_confirmed
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка при обновлении профиля" });
  }
});

// Смена пароля
router.put("/password", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { oldPassword, newPassword } = req.body || {};

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: "Укажите старый и новый пароль" });
  }

  try {
    const result = await pool.query("SELECT password FROM users WHERE id=$1", [userId]);
    if (!result.rows.length) return res.status(404).json({ error: "Пользователь не найден" });

    const user = result.rows[0];
    const ok = await bcrypt.compare(oldPassword, user.password);
    if (!ok) return res.status(400).json({ error: "Старый пароль неверен" });

    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password=$1, updated_at=NOW() WHERE id=$2", [hashed, userId]);
    res.json({ message: "Пароль обновлён" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка при смене пароля" });
  }
});

// Обновление телефона
router.put("/phone", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: "Номер телефона обязателен" });

  try {
    const result = await pool.query(
      "UPDATE users SET phone=$1, phone_confirmed=FALSE, updated_at=NOW() WHERE id=$2 RETURNING *",
      [phone, userId]
    );
    const user = result.rows[0];
    res.json({
      message: "Номер обновлён",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        journal_id: user.journal_id,
        avatar: user.avatar,
        phone: user.phone,
        email_confirmed: user.email_confirmed,
        phone_confirmed: user.phone_confirmed
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка при обновлении телефона" });
  }
});

// Обновление email
router.put("/email", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { newEmail } = req.body || {};
  if (!newEmail) return res.status(400).json({ error: "Новый email обязателен" });

  try {
    const result = await pool.query(
      "UPDATE users SET email=$1, email_confirmed=FALSE, updated_at=NOW() WHERE id=$2 RETURNING *",
      [newEmail, userId]
    );
    const user = result.rows[0];
    res.json({
      message: "Email обновлён",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        journal_id: user.journal_id,
        avatar: user.avatar,
        phone: user.phone,
        email_confirmed: user.email_confirmed,
        phone_confirmed: user.phone_confirmed
      }
    });
  } catch (err) {
    console.error(err);
    // конфликт уникальности email
    if (err.code === "23505") {
      return res.status(400).json({ error: "Email уже используется" });
    }
    res.status(500).json({ error: "Ошибка при обновлении email" });
  }
});

// Заглушка для повторной отправки кода подтверждения email
router.post("/email/resend", authMiddleware, async (req, res) => {
  // Здесь можно интегрировать реальную отправку письма
  res.json({ message: "Код подтверждения отправлен (заглушка)" });
});

// Деактивация / удаление аккаунта
router.delete("/account", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  try {
    await pool.query(
      "UPDATE users SET is_active=FALSE, token=NULL, updated_at=NOW() WHERE id=$1",
      [userId]
    );
    res.json({ message: "Аккаунт деактивирован" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка при удалении аккаунта" });
  }
});

module.exports = router;
