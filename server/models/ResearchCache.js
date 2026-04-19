const mongoose = require('mongoose');

const researchCacheSchema = new mongoose.Schema({
  queryHash: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  queryTerms: [String],
  publications: [mongoose.Schema.Types.Mixed],
  clinicalTrials: [mongoose.Schema.Types.Mixed],
  researchers: [mongoose.Schema.Types.Mixed],
  totalResults: Number,
  metadata: mongoose.Schema.Types.Mixed,
  cachedAt: {
    type: Date,
    default: Date.now
  }
});

// Correct MongoDB TTL index — expires documents 24 hours after cachedAt
researchCacheSchema.index({ cachedAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('ResearchCache', researchCacheSchema);
