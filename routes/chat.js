const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const Stock = require('../models/Stock');
const Portfolio = require('../models/Portfolio');
const { calculateFitScore } = require('../config/fitScore');

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

router.get('/markets', async (req, res) => {
  try {
    const limitRaw = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 60;
    const search = (req.query.search || '').trim();
    const sector = (req.query.sector || '').trim();

    const query = {};
    if (sector) query.sector = sector;
    if (search) {
      const pattern = new RegExp(escapeRegex(search), 'i');
      query.$or = [{ ticker: pattern }, { fullName: pattern }];
    }

    const stocks = await Stock.find(query)
      .sort({ returnPercent: -1, latestClose: -1 })
      .limit(limit)
      .lean();

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

    res.json({ count: markets.length, markets });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { message, sessionHistory = [], userId = 'demo' } = req.body;

    // Fetch user portfolio (for personalization)
    const portfolio = await Portfolio.findOne({ userId }).lean();

    // Fetch real stock data from MongoDB
    const stocks = await Stock.find({}).lean();

    // Build user profile from message context and stored portfolio
    const riskToleranceFromMsg = message.toLowerCase().includes('low risk') ? 'low' :
                     message.toLowerCase().includes('high risk') ? 'high' : 'medium';
    const preferredSectors = extractSectors(message);
    const avgReturn = portfolio?.avgReturn || 15;

    const userProfile = {
      riskTolerance: portfolio?.riskProfile?.tolerance || riskToleranceFromMsg,
      preferredSectors: portfolio?.holdings?.length ? Array.from(new Set(portfolio.holdings.map(h => h.sector))) : preferredSectors,
      availableCapital: 50000,
      averageReturn: avgReturn
    };

    // Compute embedding vector for the user's question (and their portfolio companies) for RAG-style retrieval
    const portfolioText = portfolio?.holdings?.map(h => h.company).join(' ') || '';
    const queryEmbedding = getEmbedding(`${message} ${portfolioText}`);

    // Calculate fit scores and similarity scores
    const scoredStocks = stocks.map(stock => {
      const fitScore = calculateFitScore({
        sector: stock.sector,
        returnPercentage: stock.returnPercent,
        risk: stock.risk,
        liquidity: stock.liquidity,
        minInvestment: stock.latestClose
      }, userProfile);

      const similarityScore = Math.round(((cosineSimilarity(queryEmbedding, stock.vector) + 1) / 2) * 100);
      const combinedScore = Math.round(fitScore.score * 0.75 + similarityScore * 0.25);

      return {
        company: stock.fullName,
        sector: stock.sector,
        stage: 'Listed',
        minInvestment: Math.round(stock.latestClose),
        valuation: Math.round(stock.latestClose * stock.volume),
        returnPercentage: stock.returnPercent,
        risk: stock.risk,
        liquidity: stock.liquidity,
        ticker: stock.ticker,
        latestClose: stock.latestClose,
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

    // Call Ollama
    const ollamaResponse = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:3b',
        messages: [
          {
            role: 'system',
            content: `You are Profitly, an expert AI investment assistant for Indian stock markets. 
You have access to real Nifty 50 stock data. Be concise, friendly and professional.
Always use emojis to make responses engaging. Keep responses under 3 sentences.
Here are the top matching stocks for this query:
${stockContext}`
          },
          ...sessionHistory,
          {
            role: 'user',
            content: message
          }
        ],
        stream: false
      })
    });

    const ollamaData = await ollamaResponse.json();
    const aiMessage = ollamaData.message?.content || 'Here are your top matches!';

    res.json({
      message: aiMessage,
      offerings: topStocks,
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
