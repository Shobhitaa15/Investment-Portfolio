const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const router = express.Router();
const Stock = require('../models/Stock');
const Portfolio = require('../models/Portfolio');
const { calculateFitScore } = require('../config/FitScore');
const sectorMap = require('../config/sectorMap');

const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';
const OLLAMA_ENABLED = process.env.OLLAMA_ENABLED !== 'false';
const FALLBACK_CACHE_TTL_MS = 5 * 60 * 1000;
let fallbackMarketsCache = null;
let fallbackMarketsCacheAt = 0;

const toNumber = (value, fallback = 0) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getEmbedding = (text, dim = 64) => {
  const hash = crypto.createHash('sha256').update(text).digest();
  const vector = [];
  for (let i = 0; i < dim; i++) {
    const byte = hash[i % hash.length];
    vector.push((byte / 255) * 2 - 1);
  }
  return vector;
};

const cosineSimilarity = (a = [], b = []) => {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
};

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

const loadCsvRows = (filePath) => new Promise((resolve, reject) => {
  const rows = [];
  fs.createReadStream(filePath)
    .pipe(csv())
    .on('data', (row) => rows.push(row))
    .on('end', () => resolve(rows))
    .on('error', reject);
});

const buildFallbackMarkets = async () => {
  const now = Date.now();
  if (fallbackMarketsCache && (now - fallbackMarketsCacheAt) < FALLBACK_CACHE_TTL_MS) {
    return fallbackMarketsCache;
  }

  const dataDir = path.join(__dirname, '..', 'data');
  const files = fs.readdirSync(dataDir).filter((file) => file.toLowerCase().endsWith('.csv'));
  const markets = [];

  for (const file of files) {
    const ticker = file.replace('.csv', '').replace('.NS', '').toUpperCase();
    const csvPath = path.join(dataDir, file);
    const rows = await loadCsvRows(csvPath);
    if (!rows.length) continue;

    const validRows = rows.filter((row) => row.Close && !Number.isNaN(Number.parseFloat(row.Close)));
    if (validRows.length < 2) continue;

    const latestRow = validRows[0];
    const oldestRow = validRows[validRows.length - 1];
    const latestClose = Number.parseFloat(latestRow.Close);
    const openPrice = Number.parseFloat(latestRow.Open || 0);
    const highPrice = Number.parseFloat(latestRow.High || 0);
    const lowPrice = Number.parseFloat(latestRow.Low || 0);
    const firstClose = Number.parseFloat(oldestRow.Close);
    const avgVolume = validRows.reduce((sum, row) => sum + Number.parseFloat(row.Volume || 0), 0) / validRows.length;
    const returnPercent = firstClose > 0 ? ((latestClose - firstClose) / firstClose) * 100 : 0;

    const sectorInfo = sectorMap[ticker] || { sector: 'Other', fullName: ticker };

    markets.push({
      ticker,
      fullName: sectorInfo.fullName,
      sector: sectorInfo.sector,
      latestClose: Number(latestClose.toFixed(2)),
      openPrice: Number(openPrice.toFixed(2)),
      highPrice: Number(highPrice.toFixed(2)),
      lowPrice: Number(lowPrice.toFixed(2)),
      volume: Math.round(avgVolume),
      returnPercent: Number(returnPercent.toFixed(2)),
      risk: calculateRisk(returnPercent),
      liquidity: calculateLiquidity(avgVolume),
      lastUpdated: new Date(),
    });
  }

  fallbackMarketsCache = markets;
  fallbackMarketsCacheAt = now;
  return markets;
};

const buildFallbackStocks = async () => {
  const fallbackMarkets = await buildFallbackMarkets();
  return fallbackMarkets.map((stock) => ({
    ...stock,
    vector: getEmbedding(`${stock.fullName || stock.ticker} ${stock.sector || ''}`),
  }));
};

const fetchPortfolioSafely = async (userId) => {
  try {
    return await Portfolio.findOne({ userId }).lean();
  } catch (portfolioError) {
    console.warn('Portfolio query failed, continuing without personalization:', portfolioError.message || portfolioError);
    return null;
  }
};

const fetchStocksSafely = async () => {
  try {
    const stocks = await Stock.find({}).lean();
    if (Array.isArray(stocks) && stocks.length > 0) {
      return { stocks, source: 'mongodb' };
    }
  } catch (stocksError) {
    console.warn('Stocks query failed, switching to CSV fallback:', stocksError.message || stocksError);
  }

  const fallbackStocks = await buildFallbackStocks();
  return { stocks: fallbackStocks, source: 'csv-fallback' };
};

const buildFallbackMessage = (topStocks = []) => {
  if (!topStocks.length) {
    return 'I could not find enough market data right now. Please refresh and try again.';
  }

  const highlights = topStocks
    .map((stock) => `${stock.ticker} (${stock.returnPercentage}% return, ${stock.risk} risk)`)
    .join(', ');

  return `Top matches right now: ${highlights}. Ask me to compare any two for a deeper view.`;
};

router.get('/markets', async (req, res) => {
  try {
    const limitRaw = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 60;
    const search = (req.query.search || '').trim();
    const sector = (req.query.sector || '').trim();

    const pattern = search ? new RegExp(escapeRegex(search), 'i') : null;
    const query = {};
    if (sector) query.sector = sector;
    if (pattern) query.$or = [{ ticker: pattern }, { fullName: pattern }];

    let stocks = [];
    let source = 'mongodb';

    try {
      stocks = await Stock.find(query)
        .sort({ returnPercent: -1, latestClose: -1 })
        .limit(limit)
        .lean();
    } catch (dbError) {
      console.warn('Markets DB query failed, switching to CSV fallback:', dbError.message || dbError);
      source = 'csv-fallback';
    }

    if (!stocks.length) {
      const fallback = await buildFallbackMarkets();
      source = 'csv-fallback';

      stocks = fallback
        .filter((stock) => {
          if (sector && stock.sector !== sector) return false;
          if (!pattern) return true;
          return pattern.test(stock.ticker) || pattern.test(stock.fullName || '');
        })
        .sort((a, b) => {
          if ((b.returnPercent || 0) !== (a.returnPercent || 0)) {
            return (b.returnPercent || 0) - (a.returnPercent || 0);
          }
          return (b.latestClose || 0) - (a.latestClose || 0);
        })
        .slice(0, limit);
    }

    const markets = stocks.map((stock) => ({
      ticker: stock.ticker,
      company: stock.fullName,
      sector: stock.sector,
      latestClose: stock.latestClose,
      highPrice: stock.highPrice,
      lowPrice: stock.lowPrice,
      volume: stock.volume,
      returnPercent: stock.returnPercent,
      risk: stock.risk,
      liquidity: stock.liquidity,
      lastUpdated: stock.lastUpdated,
    }));

    res.json({ count: markets.length, markets, source });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { message = '', sessionHistory = [], userId = 'demo' } = req.body;
    const normalizedMessage = String(message).trim();

    if (!normalizedMessage) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    const normalizedSessionHistory = Array.isArray(sessionHistory)
      ? sessionHistory
        .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
        .slice(-12)
      : [];

    // Fetch user portfolio (for personalization)
    const portfolio = await fetchPortfolioSafely(userId);

    // Fetch stock data from MongoDB, then fallback to CSV snapshots
    const { stocks, source: stockSource } = await fetchStocksSafely();

    // Build user profile from message context and stored portfolio
    const lowerMessage = normalizedMessage.toLowerCase();
    const riskToleranceFromMsg = lowerMessage.includes('low risk') ? 'low' :
                     lowerMessage.includes('high risk') ? 'high' : 'medium';
    const preferredSectors = extractSectors(normalizedMessage);
    const avgReturn = portfolio?.avgReturn || 15;

    const userProfile = {
      riskTolerance: portfolio?.riskProfile?.tolerance || riskToleranceFromMsg,
      preferredSectors: portfolio?.holdings?.length ? Array.from(new Set(portfolio.holdings.map(h => h.sector))) : preferredSectors,
      availableCapital: 50000,
      averageReturn: avgReturn
    };

    // Compute embedding vector for the user's question (and their portfolio companies) for RAG-style retrieval
    const portfolioText = portfolio?.holdings?.map(h => h.company).join(' ') || '';
    const queryEmbedding = getEmbedding(`${normalizedMessage} ${portfolioText}`);

    // Calculate fit scores and similarity scores
    const scoredStocks = stocks.map(stock => {
      const fitScore = calculateFitScore({
        sector: stock.sector,
        returnPercentage: toNumber(stock.returnPercent),
        risk: stock.risk,
        liquidity: stock.liquidity,
        minInvestment: toNumber(stock.latestClose)
      }, userProfile);

      const similarityScore = Math.round(((cosineSimilarity(queryEmbedding, stock.vector) + 1) / 2) * 100);
      const combinedScore = Math.round(fitScore.score * 0.75 + similarityScore * 0.25);

      return {
        company: stock.fullName || stock.ticker,
        sector: stock.sector,
        stage: 'Listed',
        minInvestment: Math.round(toNumber(stock.latestClose)),
        valuation: Math.round(toNumber(stock.latestClose) * toNumber(stock.volume)),
        returnPercentage: toNumber(stock.returnPercent),
        risk: stock.risk,
        liquidity: stock.liquidity,
        ticker: stock.ticker,
        latestClose: toNumber(stock.latestClose),
        fitScore,
        similarityScore,
        combinedScore
      };
    });

    // Sort and get top 3 most relevant stocks (RAG-style)
    const topStocks = scoredStocks
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, 3);

    // Build context for Ollama
    const stockContext = topStocks.map(s =>
      `${s.company} (${s.ticker}): Sector=${s.sector}, Return=${s.returnPercentage}%, Risk=${s.risk}, FitScore=${s.fitScore.score}/100, Relevance=${s.combinedScore}/100`
    ).join('\n');

    let aiMessage = buildFallbackMessage(topStocks);

    if (OLLAMA_ENABLED) {
      try {
        const ollamaResponse = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: OLLAMA_MODEL,
            messages: [
              {
                role: 'system',
                content: `You are Profitly, an expert AI investment assistant for Indian stock markets. 
You have access to real Nifty 50 stock data. Be concise, friendly and professional.
Always use emojis to make responses engaging. Keep responses under 3 sentences.
Here are the top matching stocks for this query:
${stockContext}`
              },
              ...normalizedSessionHistory,
              {
                role: 'user',
                content: normalizedMessage
              }
            ],
            stream: false
          })
        });

        if (!ollamaResponse.ok) {
          throw new Error(`Ollama request failed with status ${ollamaResponse.status}`);
        }

        const ollamaData = await ollamaResponse.json();
        if (ollamaData?.message?.content) {
          aiMessage = ollamaData.message.content;
        }
      } catch (ollamaError) {
        console.warn('Ollama unavailable, using fallback response:', ollamaError.message || ollamaError);
      }
    }

    res.json({
      message: aiMessage,
      offerings: topStocks,
      source: stockSource,
      suggestions: [
        "🏦 Show me banking sector stocks",
        "💊 What are healthcare options?",
        "💻 Show IT sector stocks",
        "📉 What are the low risk stocks?"
      ]
    });

  } catch (error) {
    console.log('Ollama error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

const extractSectors = (message) => {
  const sectorKeywords = {
    'IT': ['it', 'tech', 'software', 'technology'],
    'Banking': ['bank', 'banking', 'finance'],
    'Healthcare': ['health', 'pharma', 'medical', 'hospital'],
    'Automobile': ['auto', 'car', 'vehicle', 'motor'],
    'Oil & Gas': ['oil', 'gas', 'energy', 'petroleum'],
    'Consumer Goods': ['consumer', 'fmcg', 'goods'],
    'Metals': ['metal', 'steel', 'mining'],
  };

  const msg = message.toLowerCase();
  const matched = [];

  for (const [sector, keywords] of Object.entries(sectorKeywords)) {
    if (keywords.some(k => msg.includes(k))) matched.push(sector);
  }

  return matched.length > 0 ? matched : ['IT', 'Banking'];
};

module.exports = router;
