const mongoose = require('mongoose');

const stockSchema = new mongoose.Schema({
  ticker:         { type: String, required: true, unique: true },
  fullName:       { type: String },
  sector:         { type: String },
  latestClose:    { type: Number },
  openPrice:      { type: Number },
  highPrice:      { type: Number },
  lowPrice:       { type: Number },
  volume:         { type: Number },
  returnPercent:  { type: Number },
  firstClose:     { type: Number },
  risk:           { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  liquidity:      { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  priceHistory:   [{ date: String, close: Number }],
  /**
   * Vector embeddings for similarity search (RAG) - stored for each stock.
   * In a production system, this would come from an embedding model.
   */
  vector:         { type: [Number], default: [] },
  lastUpdated:    { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Stock', stockSchema);