const MODELER_SELECT = `
  SELECT u.id, u.name, u.city, u.color, u.registered,
         mp.spec, mp.category_id AS "categoryId", mp.price_from AS "priceFrom",
         mp.days, mp.skills, mp.bio, mp.rating, mp.orders_done AS "ordersDone",
         (SELECT w.image_url FROM works w WHERE w.modeler_id = u.id AND w.image_url IS NOT NULL ORDER BY w.seq LIMIT 1) AS "imageUrl"
    FROM users u
    JOIN modeler_profiles mp ON mp.user_id = u.id`;

const ORDER_SELECT = `
  SELECT o.id, o.customer_id AS "customerId", o.title, o.description,
         o.category_id AS "categoryId", o.budget, o.deadline, o.status,
         o.modeler_id AS "modelerId", o.agreed_price AS "agreedPrice",
         o.created_at AS "createdAt",
         (SELECT count(*) FROM proposals pr WHERE pr.order_id = o.id) AS "proposalsCount"
    FROM orders o`;

const WORK_SELECT = `
  SELECT w.id, w.title, w.price, w.color, w.category_id AS "categoryId",
         w.image_url AS "imageUrl", w.seq
    FROM works w`;
    

async function categoryExists(db, id) {
  if (typeof id !== 'string') return false;
  const result = await db.query('SELECT 1 FROM categories WHERE id = $1', [id]);
  return result.rows.length > 0;
}

module.exports = { MODELER_SELECT, ORDER_SELECT, WORK_SELECT, categoryExists };
