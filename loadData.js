require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const csv = require('csv-parser');
const Stock = require('./models/Stock');
const sectorMap = require('./config/sectorMap');

// Simple deterministic embedding generator for demo purposes.
// In a full implementation, replace this with an actual embedding model (Ollama/OpenAI/etc.).
const generateEmbedding = (text, dim = 64) => {
  const hash = crypto.createHash('sha256').update(text).digest();
  const vector = [];
  for (let i = 0; i < dim; i++) {
    const byte = hash[i % hash.length];
    // Map byte [0..255] to [-1..1]
    vector.push((byte / 255) * 2 - 1);
  }
  return vector;
};

const MONGODB_URI = "mongodb://portfolioadmin:admin123@cluster0-shard-00-00.drpla.mongodb.net:27017,cluster0-shard-00-01.drpla.mongodb.net:27017,cluster0-shard-00-02.drpla.mongodb.net:27017/?ssl=true&replicaSet=atlas-138fre-shard-0&authSource=admin&appName=Cluster0";

const calculateRisk = (returnPercent) => {
  if (Math.abs(returnPercent) > 30) return 'high';
  if (Math.abs(returnPercent) > 15) return 'medium';
  return 'low';
};

const calculateLiquidity = (volume) => {
  if (volume > 10000000) return 'high';
  if (volume > 1000000) return 'medium';
  return 'low';
};

const loadCSV = (filePath) => {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', reject);
  });
};

const loadAllStocks = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI, { family: 4 });
    console.log('Connected! Loading stock data...');

    const dataDir = path.join(__dirname, 'data');
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.csv'));

    console.log(`Found ${files.length} CSV files`);

    let loaded = 0;
    let failed = 0;

    for (const file of files) {
      try {
        const ticker = file.replace('.csv', '').replace('.NS', '').toUpperCase();
        const filePath = path.join(dataDir, file);
        const rows = await loadCSV(filePath);

        if (rows.length < 2) continue;

        // Filter valid rows
        const validRows = rows.filter(r => r.Close && !isNaN(parseFloat(r.Close)));
        if (validRows.length < 2) continue;

        const firstClose = parseFloat(validRows[validRows.length - 1].Close);
        const latestClose = parseFloat(validRows[0].Close);
        const returnPercent = ((latestClose - firstClose) / firstClose * 100);
        const avgVolume = validRows.reduce((sum, r) => sum + parseFloat(r.Volume || 0), 0) / validRows.length;

        // Price history (last 30 days)
        const priceHistory = validRows.slice(0, 30).map(r => ({
          date: r.Date || r.Datetime || '',
          close: parseFloat(r.Close)
        })).reverse();

        const sectorInfo = sectorMap[ticker] || { sector: 'Other', fullName: ticker };

        await Stock.findOneAndUpdate(
          { ticker },
          {
            ticker,
            fullName: sectorInfo.fullName,
            sector: sectorInfo.sector,
            latestClose: parseFloat(latestClose.toFixed(2)),
            openPrice: parseFloat(parseFloat(validRows[0].Open || 0).toFixed(2)),
            highPrice: parseFloat(parseFloat(validRows[0].High || 0).toFixed(2)),
            lowPrice: parseFloat(parseFloat(validRows[0].Low || 0).toFixed(2)),
            volume: Math.round(avgVolume),
            returnPercent: parseFloat(returnPercent.toFixed(2)),
            firstClose: parseFloat(firstClose.toFixed(2)),
            risk: calculateRisk(returnPercent),
            liquidity: calculateLiquidity(avgVolume),
            priceHistory,
            vector: generateEmbedding(`${ticker} ${sectorInfo.fullName} ${sectorInfo.sector}`),
            lastUpdated: new Date()
          },
          { upsert: true, new: true }
        );

        loaded++;
        console.log(`✅ Loaded ${ticker} — Return: ${returnPercent.toFixed(2)}% | Sector: ${sectorInfo.sector}`);
      } catch (err) {
        failed++;
        console.log(`❌ Failed: ${file} — ${err.message}`);
      }
    }

    console.log(`\n🎉 Done! Loaded: ${loaded} | Failed: ${failed}`);
    mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
    mongoose.disconnect();
  }
};

loadAllStocks();
