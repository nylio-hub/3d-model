const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { pool } = require('../db');
const { HttpError, wrap, isUuid, text, int } = require('../util');
const { requireAuth, requireRole } = require('../auth');
const { MODELER_SELECT, WORK_SELECT, categoryExists } = require('../queries');
const { COVER_COLORS } = require('../constants');

const router = express.Router();


const uploadDir = path.join(__dirname, '..', '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // максимум 5 МБ
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new HttpError(400, 'Можно загружать только изображения'));
    }
  }
});


function deleteFile(filePath) {
  if (filePath) {
    const fullPath = path.join(__dirname, '..', '..', 'public', filePath);
    fs.unlink(fullPath, (err) => {
      if (err) console.error('Не удалось удалить файл:', err);
    });
  }
}



router.get('/stats', wrap(async (req, res) => {
  const result = await pool.query(`
    SELECT (SELECT count(*) FROM modeler_profiles) AS modelers,
           (SELECT count(*) FROM works) AS works,
           (SELECT count(*) FROM orders WHERE status = 'open') AS "openOrders"`);
  res.json(result.rows[0]);
}));

router.get('/modelers', wrap(async (req, res) => {
  const result = await pool.query(`${MODELER_SELECT} ORDER BY u.registered, u.id`);
  res.json({ modelers: result.rows });
}));


router.get('/favorites', requireAuth, wrap(async (req, res) => {
  const result = await pool.query(
    `${MODELER_SELECT} JOIN favorites f ON f.modeler_id = u.id
      WHERE f.user_id = $1 ORDER BY f.seq`,
    [req.user.id]
  );
  res.json({ modelers: result.rows });
}));

router.put('/favorites/:id', requireAuth, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(404, 'Модельер не найден');
  const found = await pool.query('SELECT 1 FROM modeler_profiles WHERE user_id = $1', [req.params.id]);
  if (!found.rows.length) throw new HttpError(404, 'Модельер не найден');

  await pool.query(
    'INSERT INTO favorites (user_id, modeler_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [req.user.id, req.params.id]
  );
  res.json({ ok: true });
}));

router.delete('/favorites/:id', requireAuth, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(404, 'Модельер не найден');
  await pool.query('DELETE FROM favorites WHERE user_id = $1 AND modeler_id = $2', [req.user.id, req.params.id]);
  res.json({ ok: true });
}));


router.get('/modelers/:id', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(404, 'Модельер не найден');

  const found = await pool.query(`${MODELER_SELECT} WHERE u.id = $1`, [req.params.id]);
  if (!found.rows.length) throw new HttpError(404, 'Модельер не найден');

  const works = await pool.query(`${WORK_SELECT} WHERE modeler_id = $1 ORDER BY seq`, [req.params.id]);
  const reviews = await pool.query(
    `SELECT r.id, r.order_id AS "orderId", r.author_id AS "authorId", r.modeler_id AS "modelerId",
            r.rating, r.text, r.created_at AS "createdAt",
            json_build_object('name', a.name, 'color', a.color) AS author
       FROM reviews r JOIN users a ON a.id = r.author_id
      WHERE r.modeler_id = $1 ORDER BY r.created_at DESC`,
    [req.params.id]
  );

  res.json({ modeler: found.rows[0], works: works.rows, reviews: reviews.rows });
}));


router.put('/profile', requireRole('modeler'), wrap(async (req, res) => {
  const body = req.body || {};
  const spec = text(body.spec, 60);
  const price = int(body.priceFrom);
  const days = int(body.days);
  const bio = text(body.bio, 2000);

  if (spec.length < 3) throw new HttpError(400, 'Укажите специализацию');
  if (!(price >= 500) || price > 100000000) throw new HttpError(400, 'Минимальная стоимость не меньше 500 рублей');
  if (!(days >= 1) || days > 180) throw new HttpError(400, 'Укажите срок в днях');
  if (bio.length < 20) throw new HttpError(400, 'Опишите себя подробнее, хотя бы 20 символов');
  if (!(await categoryExists(pool, body.categoryId))) throw new HttpError(400, 'Выберите категорию');

  const skills = [];
  if (Array.isArray(body.skills)) {
    for (const item of body.skills) {
      const skill = text(item, 40);
      if (skill && skills.length < 20) skills.push(skill);
    }
  }

  await pool.query(
    `UPDATE modeler_profiles
        SET spec = $1, category_id = $2, price_from = $3, days = $4, skills = $5, bio = $6
      WHERE user_id = $7`,
    [spec, body.categoryId, price, days, skills, bio, req.user.id]
  );
  res.json({ ok: true });
}));

function readWork(body) {
  const title = text(body.title, 70);
  const price = int(body.price);

  if (title.length < 3) throw new HttpError(400, 'Введите название работы');
  if (!(price >= 500) || price > 100000000) throw new HttpError(400, 'Укажите стоимость не меньше 500 рублей');
  return { title, price };
}



router.post('/works', requireRole('modeler'), upload.single('photo'), wrap(async (req, res) => {
  const body = req.body || {};
  const work = readWork(body);
  if (!(await categoryExists(pool, body.categoryId))) throw new HttpError(400, 'Выберите категорию');

  const count = await pool.query('SELECT count(*) AS n FROM works');
  const color = COVER_COLORS[count.rows[0].n % COVER_COLORS.length];
  const id = crypto.randomUUID();
  
  
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

  await pool.query(
    `INSERT INTO works (id, modeler_id, category_id, title, price, color, image_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, req.user.id, body.categoryId, work.title, work.price, color, imageUrl]
  );
  res.status(201).json({ id });
}));



router.put('/works/:id', requireRole('modeler'), upload.single('photo'), wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(404, 'Работа не найдена');
  const body = req.body || {};
  const work = readWork(body);
  if (!(await categoryExists(pool, body.categoryId))) throw new HttpError(400, 'Выберите категорию');

 
  let imageUrlUpdate = '';
  let params = [work.title, work.price, body.categoryId, req.params.id, req.user.id];
  
  if (req.file) {
   
    const oldWork = await pool.query('SELECT image_url FROM works WHERE id = $1 AND modeler_id = $2', 
      [req.params.id, req.user.id]);
    if (oldWork.rows[0]?.image_url) {
      deleteFile(oldWork.rows[0].image_url);
    }
    imageUrlUpdate = `, image_url = $6`;
    params.push(`/uploads/${req.file.filename}`);
  }

  const result = await pool.query(
    `UPDATE works SET title = $1, price = $2, category_id = $3 WHERE id = $4 AND modeler_id = $5${imageUrlUpdate}`,
    params
  );
  if (!result.rowCount) throw new HttpError(404, 'Работа не найдена');
  res.json({ ok: true });
}));



router.delete('/works/:id', requireRole('modeler'), wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(404, 'Работа не найдена');
  
 
  const found = await pool.query('SELECT image_url FROM works WHERE id = $1 AND modeler_id = $2', 
    [req.params.id, req.user.id]);
  
  const result = await pool.query('DELETE FROM works WHERE id = $1 AND modeler_id = $2', 
    [req.params.id, req.user.id]);
  if (!result.rowCount) throw new HttpError(404, 'Работа не найдена');
  
  
  if (found.rows[0]?.image_url) {
    deleteFile(found.rows[0].image_url);
  }
  
  res.json({ ok: true });
}));

module.exports = router;