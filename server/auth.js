const crypto = require('crypto');
const { pool } = require('./db');
const { HttpError } = require('./util');

const COOKIE_NAME = 'sid';
const SESSION_DAYS = 30;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const parts = header.split(';');
  for (const part of parts) {
    const at = part.indexOf('=');
    if (at === -1) continue;
    if (part.slice(0, at).trim() === name) {
      try { return decodeURIComponent(part.slice(at + 1).trim()); } catch (e) { return null; }
    }
  }
  return null;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/'
  };
}

async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
  await pool.query(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [hashToken(token), userId, expires]
  );

  res.cookie(COOKIE_NAME, token, Object.assign(cookieOptions(), { expires }));
}

async function endSession(req, res) {
  const token = readCookie(req, COOKIE_NAME);
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

// Подставляет req.user, если в cookie лежит действующая сессия
async function loadUser(req, res, next) {
  req.user = null;
  req.sessionToken = null;

  try {
    const token = readCookie(req, COOKIE_NAME);
    if (token) {
      const result = await pool.query(
        `SELECT u.id, u.name, u.email, u.role, u.city, u.color
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = $1 AND s.expires_at > now()`,
        [hashToken(token)]
      );
      if (result.rows.length) {
        req.user = result.rows[0];
        req.sessionToken = token;
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Войдите на сайт'));
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return next(new HttpError(401, 'Войдите на сайт'));
    if (req.user.role !== role) {
      return next(new HttpError(403, role === 'customer'
        ? 'Это действие доступно только заказчикам'
        : 'Это действие доступно только модельерам'));
    }
    next();
  };
}

module.exports = { hashToken, startSession, endSession, loadUser, requireAuth, requireRole };
