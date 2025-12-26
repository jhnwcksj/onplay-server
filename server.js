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

const appointmentsRouter = require('./routes/appointments');
const clientsRouter = require('./routes/clients');
const dashboardRouter = require('./routes/dashboard');





const app = express();

// Middleware: inject req.user from JWT if present (optional, not required)
app.use((req, res, next) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.slice(7);
    try {
      const decoded = jwt.verify(token, SECRET_KEY);
      req.user = decoded;
    } catch (e) {
      req.user = undefined;
    }
  }
  next();
});
app.use(cors());
app.use(express.json());
app.use('/dashboard', dashboardRouter);

// const SECRET_KEY = "super_secret_key";

// =============================
//  Файл маршрута
// =============================
const SECRET_KEY = process.env.SECRET_KEY;

app.use("/auth",authRoutes);
app.use('/', branchesRoutes);
app.use('/', zonesRoutes);
app.use('/', networksRoutes);


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

app.use(servicesRouter);
app.use(serviceCategoriesRouter);
app.use(appointmentsRouter);
app.use(clientsRouter);

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
