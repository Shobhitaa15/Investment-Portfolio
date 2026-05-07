require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');

const app = express();

const normalizeOrigin = (value = '') => value.trim().replace(/\/+$/, '').toLowerCase();

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => normalizeOrigin(origin))
  .filter(Boolean);

const localDevOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

const localDevPorts = new Set(['3000', '4173', '5173', '5174', '5175']);

const productionWebOrigins = new Set([
  'https://investmentportfolio.netlify.app',
  'https://investmentportfolioo.netlify.app',
]);

const isPrivateNetworkHostname = (hostname = '') =>
  /^10\./.test(hostname) ||
  /^192\.168\./.test(hostname) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);

const isLocalDevOrigin = (origin = '') => {
  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();
    const isLocalHost =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      isPrivateNetworkHostname(hostname);

    return isLocalHost && localDevPorts.has(parsed.port);
  } catch {
    return false;
  }
};

const isAllowedOrigin = (origin = '') => {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return true;
  if (localDevOrigins.has(normalized)) return true;
  if (isLocalDevOrigin(normalized)) return true;
  if (productionWebOrigins.has(normalized)) return true;
  if (allowedOrigins.length === 0) return true;
  if (allowedOrigins.includes(normalized)) return true;
  if (normalized.endsWith('.netlify.app')) return true;
  return false;
};

app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      req.headers['access-control-request-headers'] || 'Content-Type, Authorization'
    );
  } else if (origin) {
    console.warn(`Blocked CORS origin: ${origin}`);
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});

app.use(
  cors({
    origin: (origin, callback) => {
      return callback(null, isAllowedOrigin(origin));
    },
    optionsSuccessStatus: 200,
  })
);
app.use(express.json());
const chatRoute = require('./routes/chat');
app.use('/api/chat', chatRoute);

const portfolioRoute = require('./routes/portfolio');
app.use('/api/portfolio', portfolioRoute);

const authRoute = require('./routes/auth');
app.use('/api/auth', authRoute);

const adminRoute = require('./routes/admin');
app.use('/api/admin', adminRoute);

app.get('/', (req, res) => {
  res.json({ message: 'Portfolio Assistant API is running!' });
});

const PORT = Number.parseInt(process.env.PORT, 10) || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const isProduction = process.env.NODE_ENV === 'production';
let serverStarted = false;

const ensureAuthSecret = () => {
  if (process.env.AUTH_TOKEN_SECRET) return;

  if (isProduction) {
    throw new Error('AUTH_TOKEN_SECRET must be set in production');
  }

  process.env.AUTH_TOKEN_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('AUTH_TOKEN_SECRET was missing; generated an in-memory dev secret for this process.');
};

const startServer = () => {
  if (serverStarted) return;
  serverStarted = true;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

const connectMongo = async () => {
  if (!MONGODB_URI) {
    console.warn('MONGODB_URI is not set. Starting server without MongoDB connection.');
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      family: 4,
      serverSelectionTimeoutMS: 10000,
    });
    console.log('Connected to MongoDB Atlas!');
  } catch (error) {
    console.warn('MongoDB connection error (continuing without DB):', error.message || error);
  }
};

const start = () => {
  ensureAuthSecret();
  startServer();
  connectMongo();
};

start();
