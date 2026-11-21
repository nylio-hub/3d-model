require('dotenv').config();
const path = require('path');
const express = require('express');
const { pool } = require('./db');
const migrate = require('./migrate');
const { loadUser } = require('./auth');
const { HttpError } = require('./util');
const multer = require('multer');
const fs = require('fs');


const app = express();
const root = path.join(__dirname, '..');


if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.disable('x-powered-by');


app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});


app.use(express.json({ limit: '100kb' }));


if (!process.env.DATABASE_URL) {
  console.error('Не задана переменная DATABASE_URL.');
  process.exit(1);
}


const uploadDir = path.join(root, 'public', 'uploads');
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
const upload = multer({ storage });


app.use(express.static(path.join(root, 'public')));
app.use('/css', express.static(path.join(root, 'css')));
app.use('/js', express.static(path.join(root, 'js')));
app.use('/assets', express.static(path.join(root, 'assets')));
app.use('/pages', express.static(path.join(root, 'pages')));


const api = express.Router();

api.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin) {
    let host = '';
    try { host = new URL(req.headers.origin).host; } catch (e) { host = ''; }
    if (host !== req.headers.host) return next(new HttpError(403, 'Запрос с чужого сайта отклонён'));
  }
  next();
});

api.use(loadUser);
api.use(require('./routes/auth'));
api.use(require('./routes/modelers'));
api.use(require('./routes/orders'));

api.use((req, res, next) => next(new HttpError(404, 'Не найдено')));

app.use('/api', api);


app.get('/', (req, res) => res.sendFile(path.join(root, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(root, 'index.html')));
app.get('/robots.txt', (req, res) => res.sendFile(path.join(root, 'robots.txt')));
app.get('/sitemap.xml', (req, res) => res.sendFile(path.join(root, 'sitemap.xml')));


app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Не найдено' });
  res.status(404).type('text').send('Страница не найдена');
});


app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Некорректные данные запроса' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Слишком большой запрос' });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера. Попробуйте позже' });
});


const port = Number(process.env.PORT) || 3000;

migrate()
  .then(() => {
    app.listen(port, () => console.log('Сайт запущен: http://localhost:' + port));
  })
  .catch((err) => {
    console.error('Не удалось подключиться к базе данных:', err.message);
    process.exit(1);
  });

process.on('SIGTERM', () => pool.end().finally(() => process.exit(0)));