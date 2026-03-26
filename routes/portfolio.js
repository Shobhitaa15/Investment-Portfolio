const express = require('express');
const router = express.Router();
const Portfolio = require('../models/Portfolio');

// Save portfolio
router.post('/save', async (req, res) => {
  try {
    const { userId = 'demo', holdings = [], riskProfile = {} } = req.body;

    // Auto calculate return % for each holding
    const processedHoldings = holdings.map(h => ({
      ...h,
      returnPercentage: parseFloat((((h.currentValue - h.entryPrice) / h.entryPrice) * 100).toFixed(2))
    }));

    const totalValue = processedHoldings.reduce((sum, h) => sum + (h.currentValue || 0), 0);
    const avgReturn = processedHoldings.length > 0
      ? parseFloat((processedHoldings.reduce((sum, h) => sum + (h.returnPercentage || 0), 0) / processedHoldings.length).toFixed(2))
      : 0;

    // Update or create portfolio
    const portfolio = await Portfolio.findOneAndUpdate(
      { userId },
      { holdings: processedHoldings, totalValue, avgReturn, riskProfile },
      { new: true, upsert: true }
    );

    res.json({ success: true, portfolio });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get portfolio
router.get('/get', async (req, res) => {
  try {
    const userId = req.query.userId || 'demo';
    const portfolio = await Portfolio.findOne({ userId });
    res.json({ portfolio });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;