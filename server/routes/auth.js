const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool, transaction } = require('../db');
const { HttpError, wrap, text, int } = require('../util');
const { startSession, endSession, requireAuth, hashToken } = require('../auth');
const { categoryExists } = require('../queries');
const { AVATAR_COLORS } = require('../constants');

const router = express.Router();

// Простое ограничение числа попыток входа/регистрации с одного адреса
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 40;

function limiter(req, res, next) {
  const now = Date.now();
  const key = req.ip;
  const entry = attempts.get(key);

  if (!entry || now - entry.start > WINDOW_MS) {
    attempts.set(key, { start: now, count: 1 });
    return next();
  }
  entry.count++;
  if (entry.count > MAX_ATTEMPTS) {
    return next(new HttpError(429, 'Слишком много попыток. Попробуйте через несколько минут'));
  }
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (now - entry.start > WINDOW_MS) attempts.delete(key);
  }
}, WINDOW_MS).unref();

async function userPayload(user) {
  const favorites = await pool.query(
    'SELECT modeler_id AS id FROM favorites WHERE user_id = $1 ORDER BY seq',
    [user.id]
  );
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    city: user.city,
    color: user.color,
    favorites: favorites.rows.map((row) => row.id)
  };
}

// Первый запрос любой страницы: кто вошёл + список категорий
router.get('/session', wrap(async (req, res) => {
  const categories = await pool.query('SELECT id, name FROM categories ORDER BY sort');
  res.json({
    user: req.user ? await userPayload(req.user) : null,
    categories: categories.rows
  });
}));

router.post('/auth/register', limiter, wrap(async (req, res) => {
  const body = req.body || {};
  const name = text(body.name, 60);
  const email = text(body.email, 120);
  const password = typeof body.password === 'string' ? body.password : '';
  const city = text(body.city, 40) || 'Не указан';
  const role = body.role;

  if (name.length < 2) throw new HttpError(400, 'Введите имя');
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new HttpError(400, 'Введите корректный адрес почты');
  if (password.length < 4) throw new HttpError(400, 'Пароль должен быть не короче 4 символов');
  if (password.length > 72) throw new HttpError(400, 'Пароль слишком длинный');
  if (role !== 'customer' && role !== 'modeler') throw new HttpError(400, 'Выберите, кто вы на площадке');

  let categoryId = null;
  let priceFrom = 5000;
  if (role === 'modeler') {
    categoryId = body.categoryId;
    priceFrom = int(body.priceFrom);
    if (!(await categoryExists(pool, categoryId))) throw new HttpError(400, 'Выберите категорию работ');
    if (!(priceFrom >= 500)) throw new HttpError(400, 'Минимальная стоимость не меньше 500 рублей');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const id = crypto.randomUUID();

  try {
    await transaction(async (db) => {
      const count = await db.query('SELECT count(*) AS n FROM users');
      const color = AVATAR_COLORS[count.rows[0].n % AVATAR_COLORS.length];

      await db.query(
        `INSERT INTO users (id, name, email, password_hash, role, city, color)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, name, email, passwordHash, role, city, color]
      );

      if (role === 'modeler') {
        await db.query(
          `INSERT INTO modeler_profiles (user_id, spec, category_id, price_from, rating, orders_done, days, skills, bio)
           VALUES ($1, 'Начинающий 3D-модельер', $2, $3, 0, 0, 7, ARRAY['Blender'], 'Профиль только создан.')`,
          [id, categoryId, priceFrom]
        );
      }
    });
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'Такая почта уже зарегистрирована');
    throw err;
  }

  await startSession(res, id);
  const user = await pool.query('SELECT id, name, email, role, city, color FROM users WHERE id = $1', [id]);
  res.status(201).json({ user: await userPayload(user.rows[0]) });
}));

router.post('/auth/login', limiter, wrap(async (req, res) => {
  const body = req.body || {};
  const email = text(body.email, 120).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';

  const result = await pool.query(
    `SELECT id, name, email, role, city, color, password_hash
       FROM users WHERE lower(email) = $1`,
    [email]
  );
  if (!result.rows.length) throw new HttpError(401, 'Пользователь с такой почтой не найден');

  const user = result.rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw new HttpError(401, 'Неверный пароль');

  await startSession(res, user.id);
  res.json({ user: await userPayload(user) });
}));

router.post('/auth/logout', wrap(async (req, res) => {
  await endSession(req, res);
  res.json({ ok: true });
}));

// Смена имени, города и пароля
router.patch('/account', requireAuth, wrap(async (req, res) => {
  const body = req.body || {};
  const name = text(body.name, 60);
  const city = text(body.city, 40) || 'Не указан';
  const oldPassword = typeof body.oldPassword === 'string' ? body.oldPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

  if (name.length < 2) throw new HttpError(400, 'Введите имя');

  let newHash = null;
  if (newPassword) {
    const current = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const ok = await bcrypt.compare(oldPassword, current.rows[0].password_hash);
    if (!ok) throw new HttpError(400, 'Текущий пароль указан неверно');
    if (newPassword.length < 4) throw new HttpError(400, 'Новый пароль должен быть не короче 4 символов');
    if (newPassword.length > 72) throw new HttpError(400, 'Пароль слишком длинный');
    newHash = await bcrypt.hash(newPassword, 10);
  }

  await pool.query(
    'UPDATE users SET name = $1, city = $2, password_hash = COALESCE($3, password_hash) WHERE id = $4',
    [name, city, newHash, req.user.id]
  );

  // После смены пароля выходим со всех остальных устройств
  if (newHash) {
    await pool.query(
      'DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2',
      [req.user.id, hashToken(req.sessionToken)]
    );
  }

  const user = await pool.query('SELECT id, name, email, role, city, color FROM users WHERE id = $1', [req.user.id]);
  res.json({ user: await userPayload(user.rows[0]) });
}));

module.exports = router;
