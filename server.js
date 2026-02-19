// Устанавливаем временную зону для всего процесса Node.js
process.env.TZ = 'Asia/Almaty';
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const pool = require("./db");
const authRoutes = require("./routes/auth");
const branchesRoutes = require("./routes/branches");
const networksRoutes = require("./routes/networks");
require('dotenv').config();
const zonesRoutes = require("./routes/zones");
const servicesRouter = require('./routes/services');
const serviceCategoriesRouter = require('./routes/service_categories');
const calendarRouter = require('./routes/calendar');

const appointmentsRouter = require('./routes/appointments');
const clientsRouter = require('./routes/clients');
const dashboardRouter = require('./routes/dashboard');
const analyticsRouter = require('./routes/analytics');
const bookingSettingsRouter = require('./routes/booking-settings');
const onlineBookingRouter = require('./routes/online-booking');
const versionRouter = require('./routes/version');
const managementRouter = require('./routes/management');
const plansRouter = require('./routes/plans');

const SECRET_KEY = process.env.SECRET_KEY;

const app = express();

// Middleware: inject req.user from JWT if present (optional, not required)
app.use((req, res, next) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.slice(7);
    try {
      if (!SECRET_KEY) {
        console.error('SECRET_KEY is not defined in environment variables');
        req.user = undefined;
      } else {
        const decoded = jwt.verify(token, SECRET_KEY);
        req.user = decoded;
        // Логируем только для management endpoints
        // if (req.path.includes('/management')) {
        //   console.log('JWT decoded successfully for', req.path, '- user:', decoded);
        // }
      }
    } catch (e) {
      // Не логируем ошибки "invalid signature" - это нормально при смене ключа
      if (e.message !== 'invalid signature' && req.path.includes('/management')) {
        console.error('JWT verification error for', req.path, ':', e.message);
      }
      req.user = undefined;
    }
  } else if (req.path.includes('/management')) {
    // console.log('No Authorization header for', req.path);
  }
  next();
});
app.use(cors());
// Увеличиваем лимит для больших данных импорта (50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/dashboard', dashboardRouter);

// const SECRET_KEY = "super_secret_key";

// =============================
//  Файл маршрута
// =============================

app.use("/auth",authRoutes);
app.use('/', branchesRoutes);
app.use('/', zonesRoutes);
app.use('/', networksRoutes);
app.use('/api/calendar', calendarRouter);


// =============================
//  Тест Баз данных
// =============================
app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ message: "OK", time: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================
//  Миграция: добавление timezone
// =============================
app.post("/api/migrate/add-timezone", async (req, res) => {
  try {
    // Добавляем колонку timezone если её нет
    await pool.query(`
      ALTER TABLE branches 
      ADD COLUMN IF NOT EXISTS timezone VARCHAR(100) DEFAULT 'Asia/Almaty'
    `);
    
    // Обновляем существующие записи где timezone NULL
    await pool.query(`
      UPDATE branches 
      SET timezone = 'Asia/Almaty' 
      WHERE timezone IS NULL
    `);
    
    res.json({ 
      success: true, 
      message: "Колонка timezone успешно добавлена в таблицу branches" 
    });
  } catch (err) {
    console.error("Migration error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Ошибка при выполнении миграции", 
      details: err.message 
    });
  }
});

app.use(servicesRouter);
app.use(serviceCategoriesRouter);
app.use(appointmentsRouter);
app.use(clientsRouter);
app.use('/analytics', analyticsRouter);
app.use('/api/booking-settings', bookingSettingsRouter);
app.use('/api/online-booking', onlineBookingRouter);
app.use('/api/version', versionRouter);
app.use('/api/management', managementRouter);
app.use(plansRouter);

// =============================
//  Регистрация
// =============================
app.post("/api/register", async (req, res) => {
  const { email, password } = req.body;

  const users = loadUsers();

  const isExists = users.find(u => u.email === email);
  if (isExists)
    return res.status(400).json({ error: "Email уже зарегистрирован" });

  const hashed = await bcrypt.hash(password, 10);

  const newUser = {
    id: users.length + 1,
    email,
    password: hashed
  };

  users.push(newUser);
  saveUsers(users);

  res.json({ message: "Пользователь создан", userId: newUser.id });
});

// =============================
//  Авторизация
// =============================
app.post("/api/login", async (req, res) => {
  try {
    // console.log("BODY:", req.body);
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "Email и пароль обязаны присутствовать" });
    }

    const users = loadUsers();
    // console.log("ALL USERS:", users);

    const user = users.find(u => u.email === email);
    // console.log("FOUND USER:", user);

    if (!user) return res.status(400).json({ error: "Неверный email" });

    const isMatch = await bcrypt.compare(password, user.password);
    // console.log("BCRYPT MATCH:", isMatch);

    if (!isMatch) return res.status(400).json({ error: "Неверный пароль" });

    const token = jwt.sign({ id: user.id }, SECRET_KEY, { expiresIn: "30d" });

    res.json({ token, userId: user.id });
  } catch (err) {
    // По возможности можно оставить логирование ошибок
    // console.error("LOGIN ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// =============================
//  Проверка токена (опционально)
// =============================
app.get("/api/check", (req, res) => {
  const token = req.headers.authorization;

  if (!token)
    return res.status(401).json({ error: "Токен отсутствует" });

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    res.json({ valid: true, userId: decoded.id });
  } catch (e) {
    res.status(401).json({ valid: false });
  }
});

// =============================
//  Запуск сервера
// =============================
app.listen(5000, () => {
  console.log("Backend запущен на http://localhost:5000");
});
