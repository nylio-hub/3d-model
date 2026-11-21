const { Pool, types } = require('pg');


types.setTypeParser(1082, (value) => value);
types.setTypeParser(1700, (value) => parseFloat(value));
types.setTypeParser(20, (value) => parseInt(value, 10));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});

pool.on('error', (err) => {
  console.error('Ошибка соединения с базой:', err.message);
});


async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, transaction };
