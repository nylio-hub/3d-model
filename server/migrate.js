require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

module.exports = migrate;

if (require.main === module) {
  migrate()
    .then(() => { console.log('База данных готова'); return pool.end(); })
    .catch((err) => { console.error('Не удалось создать таблицы:', err.message); process.exit(1); });
}
