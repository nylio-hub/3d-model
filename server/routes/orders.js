const express = require('express');
const crypto = require('crypto');
const { pool, transaction } = require('../db');
const { HttpError, wrap, isUuid, text, int, dateOk } = require('../util');
const { requireAuth, requireRole } = require('../auth');
const { MODELER_SELECT, ORDER_SELECT, categoryExists } = require('../queries');

const router = express.Router();

function checkId(id) {
  if (!isUuid(id)) throw new HttpError(404, 'Заказ не найден');
}


async function lockOrder(db, id) {
  const result = await db.query(
    `SELECT id, customer_id AS "customerId", status, modeler_id AS "modelerId", agreed_price AS "agreedPrice"
       FROM orders WHERE id = $1 FOR UPDATE`,
    [id]
  );
  if (!result.rows.length) throw new HttpError(404, 'Заказ не найден');
  return result.rows[0];
}

function mustOwn(order, user) {
  if (order.customerId !== user.id) throw new HttpError(403, 'Это чужой заказ');
}

function readOrder(body) {
  const title = text(body.title, 90);
  const description = text(body.description, 5000);
  const budget = int(body.budget);
  const deadline = body.deadline;

  if (title.length < 5) throw new HttpError(400, 'Название должно быть не короче 5 символов');
  if (description.length < 20) throw new HttpError(400, 'Опишите задачу подробнее, хотя бы 20 символов');
  if (!(budget >= 500)) throw new HttpError(400, 'Укажите бюджет не меньше 500 рублей');
  if (budget > 100000000) throw new HttpError(400, 'Слишком большой бюджет');
  if (!dateOk(deadline)) throw new HttpError(400, 'Выберите срок сдачи');

  
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (deadline < yesterday) {
    throw new HttpError(400, 'Срок сдачи не может быть в прошлом');
  }
  return { title, description, budget, deadline };
}


router.get('/orders', wrap(async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const result = status
    ? await pool.query(`${ORDER_SELECT} WHERE o.status = $1 ORDER BY o.created_at DESC`, [status])
    : await pool.query(`${ORDER_SELECT} ORDER BY o.created_at DESC`);
  res.json({ orders: result.rows });
}));


router.get('/account/overview', requireAuth, wrap(async (req, res) => {
  const user = req.user;

  if (user.role === 'customer') {
    const orders = await pool.query(
      `${ORDER_SELECT} WHERE o.customer_id = $1 ORDER BY o.created_at DESC`, [user.id]
    );
    return res.json({ orders: orders.rows });
  }

  const orders = await pool.query(
    `${ORDER_SELECT} WHERE o.modeler_id = $1 ORDER BY o.created_at DESC`, [user.id]
  );
  const proposals = await pool.query(
    `SELECT p.id, p.order_id AS "orderId", p.price, p.days, p.status, p.created_at AS "createdAt",
            o.title AS "orderTitle"
       FROM proposals p JOIN orders o ON o.id = p.order_id
      WHERE p.modeler_id = $1 ORDER BY p.seq`,
    [user.id]
  );
  const profile = await pool.query(`${MODELER_SELECT} WHERE u.id = $1`, [user.id]);

  res.json({ orders: orders.rows, proposals: proposals.rows, profile: profile.rows[0] || null });
}));


router.get('/orders/:id', wrap(async (req, res) => {
  checkId(req.params.id);

  const found = await pool.query(`${ORDER_SELECT} WHERE o.id = $1`, [req.params.id]);
  if (!found.rows.length) throw new HttpError(404, 'Заказ не найден');
  const order = found.rows[0];

  const people = await pool.query(
    'SELECT id, name, color FROM users WHERE id = ANY($1::uuid[])',
    [[order.customerId, order.modelerId].filter(Boolean)]
  );
  const customer = people.rows.find((u) => u.id === order.customerId) || null;
  const worker = order.modelerId ? people.rows.find((u) => u.id === order.modelerId) || null : null;

  const proposals = await pool.query(
    `SELECT p.id, p.order_id AS "orderId", p.modeler_id AS "modelerId", p.price, p.days,
            p.message, p.status, p.created_at AS "createdAt",
            json_build_object('id', u.id, 'name', u.name, 'color', u.color,
                              'spec', mp.spec, 'rating', mp.rating) AS modeler
       FROM proposals p
       JOIN users u ON u.id = p.modeler_id
       JOIN modeler_profiles mp ON mp.user_id = p.modeler_id
      WHERE p.order_id = $1 ORDER BY p.seq`,
    [order.id]
  );

  const review = await pool.query('SELECT 1 FROM reviews WHERE order_id = $1', [order.id]);

  
  let messages = [];
  const me = req.user;
  const participant = me && (me.id === order.customerId || me.id === order.modelerId);
  if (participant && order.modelerId) {
    const list = await pool.query(
      `SELECT m.id, m.author_id AS "authorId", m.text, m.created_at AS "createdAt",
              json_build_object('name', u.name) AS author
         FROM messages m JOIN users u ON u.id = m.author_id
        WHERE m.order_id = $1 ORDER BY m.created_at, m.seq`,
      [order.id]
    );
    messages = list.rows;
  }

  res.json({
    order,
    customer,
    worker,
    proposals: proposals.rows,
    messages,
    hasReview: review.rows.length > 0
  });
}));

router.post('/orders', requireRole('customer'), wrap(async (req, res) => {
  const body = req.body || {};
  const data = readOrder(body);
  if (!(await categoryExists(pool, body.categoryId))) throw new HttpError(400, 'Выберите категорию');

  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO orders (id, customer_id, title, description, category_id, budget, deadline)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, req.user.id, data.title, data.description, body.categoryId, data.budget, data.deadline]
  );
  res.status(201).json({ id });
}));

router.put('/orders/:id', requireRole('customer'), wrap(async (req, res) => {
  checkId(req.params.id);
  const body = req.body || {};
  const data = readOrder(body);
  if (!(await categoryExists(pool, body.categoryId))) throw new HttpError(400, 'Выберите категорию');

  await transaction(async (db) => {
    const order = await lockOrder(db, req.params.id);
    mustOwn(order, req.user);
    if (order.status !== 'open') throw new HttpError(409, 'Заказ уже в работе, менять условия нельзя');

    await db.query(
      `UPDATE orders SET title = $1, description = $2, category_id = $3, budget = $4, deadline = $5
        WHERE id = $6`,
      [data.title, data.description, body.categoryId, data.budget, data.deadline, order.id]
    );
  });
  res.json({ id: req.params.id });
}));

router.delete('/orders/:id', requireRole('customer'), wrap(async (req, res) => {
  checkId(req.params.id);

  await transaction(async (db) => {
    const order = await lockOrder(db, req.params.id);
    mustOwn(order, req.user);
    if (order.status !== 'open') throw new HttpError(409, 'Удалить можно только заказ, который ещё не взят в работу');
    await db.query('DELETE FROM orders WHERE id = $1', [order.id]);
  });
  res.json({ ok: true });
}));


router.post('/orders/:id/:action(submit|approve|rework|cancel)', requireAuth, wrap(async (req, res) => {
  checkId(req.params.id);
  const action = req.params.action;

  await transaction(async (db) => {
    const order = await lockOrder(db, req.params.id);
    const isOwner = order.customerId === req.user.id;
    const isWorker = order.modelerId === req.user.id;

    if (action === 'submit') {
      if (!isWorker) throw new HttpError(403, 'Сдать работу может только исполнитель заказа');
      if (order.status !== 'in_progress') throw new HttpError(409, 'Заказ сейчас не в работе');
      await db.query("UPDATE orders SET status = 'review' WHERE id = $1", [order.id]);
      return;
    }

    if (!isOwner) throw new HttpError(403, 'Это чужой заказ');

    if (action === 'approve') {
      if (order.status !== 'review') throw new HttpError(409, 'Работа ещё не сдана на проверку');
      await db.query("UPDATE orders SET status = 'done' WHERE id = $1", [order.id]);
      await db.query(
        'UPDATE modeler_profiles SET orders_done = orders_done + 1 WHERE user_id = $1',
        [order.modelerId]
      );
    } else if (action === 'rework') {
      if (order.status !== 'review') throw new HttpError(409, 'Работа ещё не сдана на проверку');
      await db.query("UPDATE orders SET status = 'in_progress' WHERE id = $1", [order.id]);
    } else {
      if (order.status !== 'in_progress' && order.status !== 'review') {
        throw new HttpError(409, 'Этот заказ нельзя отменить');
      }
      await db.query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [order.id]);
    }
  });
  res.json({ ok: true });
}));

router.post('/orders/:id/review', requireRole('customer'), wrap(async (req, res) => {
  checkId(req.params.id);
  const body = req.body || {};
  const rating = int(body.rating);
  const reviewText = text(body.text, 2000);

  if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, 'Поставьте оценку от 1 до 5');
  if (reviewText.length < 5) throw new HttpError(400, 'Напишите несколько слов в отзыве');

  await transaction(async (db) => {
    const order = await lockOrder(db, req.params.id);
    mustOwn(order, req.user);
    if (order.status !== 'done' || !order.modelerId) throw new HttpError(409, 'Отзыв можно оставить после завершения заказа');

    const exists = await db.query('SELECT 1 FROM reviews WHERE order_id = $1', [order.id]);
    if (exists.rows.length) throw new HttpError(409, 'Отзыв уже оставлен');

    await db.query(
      `INSERT INTO reviews (id, order_id, author_id, modeler_id, rating, text)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [crypto.randomUUID(), order.id, req.user.id, order.modelerId, rating, reviewText]
    );
    await db.query(
      `UPDATE modeler_profiles
          SET rating = (SELECT ROUND(AVG(rating)::numeric, 1) FROM reviews WHERE modeler_id = $1)
        WHERE user_id = $1`,
      [order.modelerId]
    );
  });
  res.status(201).json({ ok: true });
}));

router.post('/orders/:id/messages', requireAuth, wrap(async (req, res) => {
  checkId(req.params.id);
  const message = text((req.body || {}).text, 2000);
  if (!message) throw new HttpError(400, 'Напишите сообщение');

  await transaction(async (db) => {
    const order = await lockOrder(db, req.params.id);
    const participant = order.customerId === req.user.id || order.modelerId === req.user.id;
    if (!order.modelerId || !participant) throw new HttpError(403, 'Переписка доступна заказчику и исполнителю');

    await db.query(
      'INSERT INTO messages (id, order_id, author_id, text) VALUES ($1, $2, $3, $4)',
      [crypto.randomUUID(), order.id, req.user.id, message]
    );
  });
  res.status(201).json({ ok: true });
}));

router.post('/orders/:id/proposals', requireRole('modeler'), wrap(async (req, res) => {
  checkId(req.params.id);
  const body = req.body || {};
  const price = int(body.price);
  const days = int(body.days);
  const message = text(body.message, 2000);

  if (!(price >= 500)) throw new HttpError(400, 'Укажите цену не меньше 500 рублей');
  if (price > 100000000) throw new HttpError(400, 'Слишком большая цена');
  if (!(days >= 1 && days <= 180)) throw new HttpError(400, 'Срок должен быть от 1 до 180 дней');
  if (message.length < 10) throw new HttpError(400, 'Напишите пару предложений заказчику');

  try {
    await transaction(async (db) => {
      const order = await lockOrder(db, req.params.id);
      if (order.status !== 'open') throw new HttpError(409, 'Заказ уже не принимает отклики');

      await db.query(
        `INSERT INTO proposals (id, order_id, modeler_id, price, days, message)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [crypto.randomUUID(), order.id, req.user.id, price, days, message]
      );
    });
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'Вы уже откликнулись на этот заказ');
    throw err;
  }
  res.status(201).json({ ok: true });
}));

router.post('/proposals/:id/accept', requireRole('customer'), wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(404, 'Отклик не найден');

  await transaction(async (db) => {
    const found = await db.query(
      'SELECT order_id AS "orderId", modeler_id AS "modelerId", price, status FROM proposals WHERE id = $1',
      [req.params.id]
    );
    if (!found.rows.length) throw new HttpError(404, 'Отклик не найден');
    const proposal = found.rows[0];

    const order = await lockOrder(db, proposal.orderId);
    mustOwn(order, req.user);
    if (order.status !== 'open') throw new HttpError(409, 'Исполнитель по этому заказу уже выбран');

    await db.query(
      `UPDATE proposals SET status = CASE WHEN id = $1 THEN 'accepted' ELSE 'rejected' END
        WHERE order_id = $2`,
      [req.params.id, order.id]
    );
    await db.query(
      `UPDATE orders SET modeler_id = $1, agreed_price = $2, status = 'in_progress' WHERE id = $3`,
      [proposal.modelerId, proposal.price, order.id]
    );
  });
  res.json({ ok: true });
}));

router.delete('/proposals/:id', requireRole('modeler'), wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(404, 'Отклик не найден');

  await transaction(async (db) => {
    const found = await db.query(
      'SELECT order_id AS "orderId", modeler_id AS "modelerId", status FROM proposals WHERE id = $1',
      [req.params.id]
    );
    if (!found.rows.length || found.rows[0].modelerId !== req.user.id) throw new HttpError(404, 'Отклик не найден');

    const order = await lockOrder(db, found.rows[0].orderId);
    if (order.status !== 'open' || found.rows[0].status !== 'sent') {
      throw new HttpError(409, 'Этот отклик уже нельзя отозвать');
    }
    await db.query('DELETE FROM proposals WHERE id = $1', [req.params.id]);
  });
  res.json({ ok: true });
}));

module.exports = router;
