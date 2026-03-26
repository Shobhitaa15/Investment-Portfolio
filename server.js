require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

app.use(cors());
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

const MONGODB_URI = "mongodb://portfolioadmin:admin123@cluster0-shard-00-00.drpla.mongodb.net:27017,cluster0-shard-00-01.drpla.mongodb.net:27017,cluster0-shard-00-02.drpla.mongodb.net:27017/?ssl=true&replicaSet=atlas-138fre-shard-0&authSource=admin&appName=Cluster0";

const startServer = () => {
  app.listen(5000, () => {
    console.log('Server running on port 5000');
  });
};

mongoose.connect(MONGODB_URI, { family: 4 })
  .then(() => {
    console.log('Connected to MongoDB Atlas!');
    startServer();
  })
  .catch((error) => {
    console.warn('MongoDB connection error (continuing without DB):', error.message || error);
    startServer();
  });
