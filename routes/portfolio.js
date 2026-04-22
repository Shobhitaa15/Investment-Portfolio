const express = require('express');
const router = express.Router();
const Portfolio = require('../models/Portfolio');
const { calculateFitScore } = require('../config/FitScore');
const requireAuth = require('../middleware/auth');

const VALID_RISK = new Set(['low', 'medium', 'high']);
const VALID_HORIZON = new Set(['short', 'medium', 'long']);
const VALID_GOAL = new Set(['growth', 'income', 'preservation']);

const toNumber = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const inferRisk = (returnPercentage) => {
  const absoluteReturn = Math.abs(returnPercentage);
  if (absoluteReturn <= 8) return 'low';
  if (absoluteReturn <= 20) return 'medium';
  return 'high';
};

const inferLiquidity = (currentValue) => {
  if (currentValue >= 50000) return 'high';
  if (currentValue >= 10000) return 'medium';
  return 'low';
};

const normalizeRiskProfile = (riskProfile = {}) => {
  const tolerance = String(riskProfile.tolerance || 'medium').toLowerCase();
  const horizon = String(riskProfile.horizon || 'medium').toLowerCase();
  const goal = String(riskProfile.goal || 'growth').toLowerCase();

  return {
    tolerance: VALID_RISK.has(tolerance) ? tolerance : 'medium',
    horizon: VALID_HORIZON.has(horizon) ? horizon : 'medium',
    goal: VALID_GOAL.has(goal) ? goal : 'growth',
  };
};

const normalizeHolding = (holding = {}) => {
  const company = String(holding.company || '').trim();
  const sector = String(holding.sector || '').trim();
  const entryPrice = toNumber(holding.entryPrice);
  const currentValue = toNumber(holding.currentValue);

  if (!company || !sector || entryPrice <= 0 || currentValue <= 0) {
    return null;
  }

  const returnPercentage = Number((((currentValue - entryPrice) / entryPrice) * 100).toFixed(2));
  const minInvestment = toNumber(holding.minInvestment) || entryPrice;
  const valuation = toNumber(holding.valuation) || currentValue;
  const riskRaw = String(holding.risk || '').toLowerCase();
  const liquidityRaw = String(holding.liquidity || '').toLowerCase();

  return {
    ...holding,
    company,
    sector,
    entryPrice,
    currentValue,
    returnPercentage,
    stage: holding.stage || 'N/A',
    minInvestment,
    valuation,
    estimatedExitDate: holding.estimatedExitDate || 'N/A',
    risk: VALID_RISK.has(riskRaw) ? riskRaw : inferRisk(returnPercentage),
    liquidity: VALID_RISK.has(liquidityRaw) ? liquidityRaw : inferLiquidity(currentValue),
  };
};

router.use(requireAuth);

// Save portfolio
router.post('/save', async (req, res) => {
  try {
    const { holdings = [], riskProfile = {} } = req.body;
    const userId = req.user?.id;

    if (!Array.isArray(holdings) || holdings.length === 0) {
      return res.status(400).json({ error: 'Holdings array is required.' });
    }

    const normalizedHoldings = holdings
      .map((holding) => normalizeHolding(holding))
      .filter(Boolean);

    if (!normalizedHoldings.length) {
      return res.status(400).json({ error: 'No valid holdings to score. Include company, sector, entryPrice and currentValue.' });
    }

    const totalValue = normalizedHoldings.reduce((sum, holding) => sum + (holding.currentValue || 0), 0);
    const totalInvested = normalizedHoldings.reduce((sum, holding) => sum + (holding.entryPrice || 0), 0);
    const avgReturn = normalizedHoldings.length > 0
      ? Number((normalizedHoldings.reduce((sum, holding) => sum + (holding.returnPercentage || 0), 0) / normalizedHoldings.length).toFixed(2))
      : 0;

    const normalizedRiskProfile = normalizeRiskProfile(riskProfile);
    const preferredSectors = Array.from(new Set(normalizedHoldings.map((holding) => holding.sector))).filter(Boolean);
    const userProfile = {
      riskTolerance: normalizedRiskProfile.tolerance,
      preferredSectors: preferredSectors.length ? preferredSectors : ['IT', 'Banking'],
      availableCapital: totalInvested > 0 ? totalInvested : 50000,
      averageReturn: Math.max(Math.abs(avgReturn), 8),
    };

    const scoredHoldings = normalizedHoldings.map((holding) => {
      const fitScore = calculateFitScore({
        sector: holding.sector,
        returnPercentage: holding.returnPercentage,
        risk: holding.risk,
        liquidity: holding.liquidity,
        minInvestment: holding.minInvestment,
      }, userProfile);

      return {
        ...holding,
        fitScore,
      };
    });

    const overallFitScore = scoredHoldings.length > 0
      ? Number((scoredHoldings.reduce((sum, holding) => sum + (holding.fitScore?.score || 0), 0) / scoredHoldings.length).toFixed(1))
      : 0;

    // Update or create portfolio
    const portfolio = await Portfolio.findOneAndUpdate(
      { userId },
      {
        holdings: scoredHoldings,
        totalValue,
        avgReturn,
        overallFitScore,
        riskProfile: normalizedRiskProfile,
      },
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
    const userId = req.user?.id;
    const portfolio = await Portfolio.findOne({ userId });
    res.json({ portfolio });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
