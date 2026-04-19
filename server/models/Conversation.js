const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant'],
    required: true
  },
  content: {
    type: String,
    required: true,
    default: '...'
  },
  structuredInput: {
    disease: String,
    query: String,
    location: String,
    patientName: String
  },
  response: {
    conditionOverview: String,
    researchInsights: String,
    clinicalTrialsSummary: String,
    personalizedRecommendation: String,
    keyFindings: [mongoose.Schema.Types.Mixed],
    publications: [{
      title: String,
      authors: [String],
      year: Number,
      source: String,
      sourceJournal: String,
      url: String,
      abstract: String,
      citationCount: Number,
      relevanceScore: Number,
      isOpenAccess: Boolean,
      topics: [String]
    }],
    clinicalTrials: [{
      nctId: String,
      title: String,
      status: String,
      phase: String,
      eligibility: String,
      eligibilitySex: String,
      eligibilityMinAge: String,
      eligibilityMaxAge: String,
      location: String,
      contact: String,
      url: String,
      summary: String,
      sponsor: String,
      startDate: String,
      completionDate: String,
      enrollmentCount: Number,
      relevanceScore: Number
    }],
    researchers: [{
      name: String,
      institution: String,
      country: String,
      citationCount: Number,
      worksCount: Number,
      hIndex: Number,
      i10Index: Number,
      orcid: String,
      url: String,
      topics: [String]
    }]
  },
  pipelineMetrics: {
    totalRetrieved: Number,
    totalAfterDedup: Number,
    selectedPublications: Number,
    selectedTrials: Number,
    queryExpansionTimeMs: Number,
    retrievalTimeMs: Number,
    rankingTimeMs: Number,
    llmTimeMs: Number,
    totalTimeMs: Number,
    expandedQueries: [String],
    isResearcherQuery: Boolean,
    fromCache: String,
    sources: mongoose.Schema.Types.Mixed
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { strict: false });

const conversationSchema = new mongoose.Schema({
  conversationId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
    index: true
  },
  title: {
    type: String,
    default: 'New Conversation'
  },
  userProfile: {
    patientName: String,
    diseaseOfInterest: String,
    location: String,
    additionalContext: String
  },
  messages: [messageSchema],
  metadata: {
    lastDisease: String,
    lastIntent: String,
    lastLocation: String,
    totalMessages: { type: Number, default: 0 }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

conversationSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  this.metadata.totalMessages = this.messages.length;
  next();
});

module.exports = mongoose.model('Conversation', conversationSchema);
