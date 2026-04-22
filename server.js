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

const isAllowedOrigin = (origin = '') => {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return true;
  if (allowedOrigins.length === 0) return true;
  if (allowedOrigins.includes(normalized)) return true;
  if (normalized.endsWith('.netlify.app')) return true;
  return false;
};

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

app.get('/', (req, res) => {
  res.json({ message: 'Portfolio Assistant API is running!' });
});

const PORT = Number.parseInt(process.env.PORT, 10) || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const isProduction = process.env.NODE_ENV === 'production';

const ensureAuthSecret = () => {
  if (process.env.AUTH_TOKEN_SECRET) return;

  if (isProduction) {
    throw new Error('AUTH_TOKEN_SECRET must be set in production');
  }

  process.env.AUTH_TOKEN_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('AUTH_TOKEN_SECRET was missing; generated an in-memory dev secret for this process.');
};

const startServer = () => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

const start = async () => {
  ensureAuthSecret();

  if (!MONGODB_URI) {
    console.warn('MONGODB_URI is not set. Starting server without MongoDB connection.');
    startServer();
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI, { family: 4 });
    console.log('Connected to MongoDB Atlas!');
  } catch (error) {
    console.warn('MongoDB connection error (continuing without DB):', error.message || error);
  }

  startServer();
};

start();
