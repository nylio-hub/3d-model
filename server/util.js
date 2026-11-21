const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Обёртка, чтобы ошибки из async-обработчиков попадали в общий обработчик ошибок
function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function text(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function int(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

function dateOk(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === value;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { HttpError, wrap, isUuid, text, int, dateOk, todayUtc };
