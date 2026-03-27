const mongoose = require('mongoose');

const holdingSchema = new mongoose.Schema({
  company: { type: String, required: true },
  sector: { type: String, required: true },
  entryPrice: { type: Number, required: true },
  currentValue: { type: Number, required: true },
  returnPercentage: { type: Number },
  stage: { type: String, default: 'N/A' },
  minInvestment: { type: Number, default: 0 },
  valuation: { type: Number, default: 0 },
  estimatedExitDate: { type: String, default: 'N/A' },
  risk: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  liquidity: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  fitScore: {
    score: { type: Number, default: 0 },
    explanation: { type: String, default: '' },
  },
});

const portfolioSchema = new mongoose.Schema({
  userId: { type: String, default: 'demo' },
  holdings: [holdingSchema],
  riskProfile: {
    tolerance: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    horizon: { type: String, enum: ['short', 'medium', 'long'], default: 'medium' },
    goal: { type: String, enum: ['growth', 'income', 'preservation'], default: 'growth' }
  },
  totalValue: { type: Number, default: 0 },
  avgReturn: { type: Number, default: 0 },
  overallFitScore: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Portfolio', portfolioSchema);
