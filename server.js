require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('CORS origin denied'));
    },
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

const startServer = () => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

const start = async () => {
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
