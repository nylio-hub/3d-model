CREATE TABLE IF NOT EXISTS categories (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  sort  INTEGER NOT NULL
);


INSERT INTO categories (id, name, sort) VALUES
  ('c1', 'Персонажи', 1),
  ('c2', 'Оружие и техника', 2),
  ('c3', 'Архитектура', 3),
  ('c4', 'Интерьер и мебель', 4),
  ('c5', 'Модели для 3D-печати', 5),
  ('c6', 'Игровые ассеты', 6),
  ('c7', 'Украшения', 7),
  ('c8', 'Продуктовая визуализация', 8)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('customer', 'modeler')),
  city           TEXT NOT NULL DEFAULT 'Не указан',
  color          TEXT NOT NULL,
  registered     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email));

CREATE TABLE IF NOT EXISTS modeler_profiles (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  spec         TEXT NOT NULL,
  category_id  TEXT NOT NULL REFERENCES categories(id),
  price_from   INTEGER NOT NULL CHECK (price_from >= 0),
  rating       NUMERIC(2,1) NOT NULL DEFAULT 0,
  orders_done  INTEGER NOT NULL DEFAULT 0,
  days         INTEGER NOT NULL CHECK (days >= 1),
  skills       TEXT[] NOT NULL DEFAULT '{}',
  bio          TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS works (
  id           UUID PRIMARY KEY,
  seq          BIGSERIAL,
  modeler_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id  TEXT NOT NULL REFERENCES categories(id),
  title        TEXT NOT NULL,
  price        INTEGER NOT NULL CHECK (price >= 0),
  color        TEXT NOT NULL,
  image_url TEXT
);
CREATE INDEX IF NOT EXISTS works_modeler_idx ON works (modeler_id);

CREATE TABLE IF NOT EXISTS orders (
  id            UUID PRIMARY KEY,
  customer_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  category_id   TEXT NOT NULL REFERENCES categories(id),
  budget        INTEGER NOT NULL CHECK (budget >= 0),
  deadline      DATE NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'in_progress', 'review', 'done', 'cancelled')),
  modeler_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  agreed_price  INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders (customer_id);
CREATE INDEX IF NOT EXISTS orders_modeler_idx ON orders (modeler_id);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);

CREATE TABLE IF NOT EXISTS proposals (
  id          UUID PRIMARY KEY,
  seq         BIGSERIAL,
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  modeler_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  price       INTEGER NOT NULL CHECK (price >= 0),
  days        INTEGER NOT NULL CHECK (days >= 1),
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'accepted', 'rejected')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, modeler_id)
);
CREATE INDEX IF NOT EXISTS proposals_modeler_idx ON proposals (modeler_id);

CREATE TABLE IF NOT EXISTS reviews (
  id          UUID PRIMARY KEY,
  order_id    UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  modeler_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reviews_modeler_idx ON reviews (modeler_id);

CREATE TABLE IF NOT EXISTS messages (
  id          UUID PRIMARY KEY,
  seq         BIGSERIAL,
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_order_idx ON messages (order_id);

CREATE TABLE IF NOT EXISTS favorites (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  modeler_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seq         BIGSERIAL,
  PRIMARY KEY (user_id, modeler_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
