module.exports = {
  // API Endpoints
  OPENALEX_BASE: 'https://api.openalex.org/works',
  OPENALEX_AUTHORS_BASE: 'https://api.openalex.org/authors',
  PUBMED_SEARCH: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi',
  PUBMED_FETCH: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi',
  CLINICAL_TRIALS_BASE: 'https://clinicaltrials.gov/api/v2/studies',

  // Retrieval limits — depth-first strategy (retrieve many, rank to few)
  OPENALEX_PER_PAGE: 50,
  OPENALEX_PAGES: 3,             // 50 × 3 = 150 per query
  PUBMED_RETMAX: 50,             // 50 per query
  CLINICAL_TRIALS_PAGE_SIZE: 25, // 25 per status × 3 statuses = 75 total

  // Cache TTL
  REDIS_TTL: 3600,  // 1 hour (Redis — fast in-memory)
  MONGO_TTL: 86400, // 24 hours (MongoDB — persistent fallback)

  // Ranking weights — Publications
  // score = relevance(0.40) + recency(0.25) + credibility(0.20) + citations(0.15)
  PUB_RELEVANCE_WEIGHT: 0.40,
  PUB_RECENCY_WEIGHT: 0.25,
  PUB_CREDIBILITY_WEIGHT: 0.20,
  PUB_CITATION_WEIGHT: 0.15,

  // Ranking weights — Clinical Trials
  // score = relevance(0.35) + status(0.25) + location(0.25) + recency(0.15)
  CT_RELEVANCE_WEIGHT: 0.35,
  CT_STATUS_WEIGHT: 0.25,
  CT_LOCATION_WEIGHT: 0.25,
  CT_RECENCY_WEIGHT: 0.15,

  // Output limits (shown to user after ranking)
  TOP_PUBLICATIONS: 8,
  TOP_CLINICAL_TRIALS: 6,
  TOP_RESEARCHERS: 10,

  // LLM Models (Groq)
  MODELS: {
    QUERY_EXPANSION: 'llama-3.1-8b-instant',   // Fast, for query processing
    RERANKING: 'llama-3.1-8b-instant',
    REASONING: 'qwen/qwen3-32b',               // Using Qwen 32B
    TITLE_GEN: 'llama-3.1-8b-instant',         // Fast, for conversation titles
    VOICE: 'llama-3.1-8b-instant',             // Dedicated fast model to avoid reasoning tokens in TTS
    VISION: 'llama-3.2-90b-vision-preview',    // Vision model for reading medical docs from images
  },

  // High-impact medical journals for credibility scoring
  HIGH_IMPACT_JOURNALS: [
    'new england journal of medicine', 'the lancet', 'jama', 'bmj',
    'nature medicine', 'nature', 'science', 'cell', 'annals of internal medicine',
    'circulation', 'journal of clinical oncology', 'blood',
    'journal of the american college of cardiology', 'gastroenterology',
    'gut', 'hepatology', 'american journal of respiratory and critical care medicine',
    'european heart journal', 'diabetes care', 'the lancet oncology',
    'the lancet neurology', 'the lancet infectious diseases', 'plos medicine',
    'nature reviews', 'annual review', 'clinical infectious diseases',
    'journal of infectious diseases', 'chest', 'radiology', 'brain',
    'neurology', 'stroke', 'cancer research', 'journal of allergy',
  ],

  // Medical synonym map for intelligent query expansion
  MEDICAL_SYNONYMS: {
    'heart attack': ['myocardial infarction', 'acute coronary syndrome', 'MI', 'ACS'],
    'high blood pressure': ['hypertension', 'elevated blood pressure', 'arterial hypertension'],
    'sugar disease': ['diabetes mellitus', 'type 2 diabetes', 'T2DM'],
    'diabetes': ['diabetes mellitus', 'type 2 diabetes', 'T2DM', 'hyperglycemia'],
    'cancer': ['neoplasm', 'malignancy', 'carcinoma', 'tumor', 'oncology'],
    'lung cancer': ['non-small cell lung cancer', 'NSCLC', 'pulmonary neoplasm', 'SCLC'],
    'brain tumor': ['glioma', 'glioblastoma', 'GBM', 'intracranial neoplasm', 'meningioma'],
    'alzheimer': ["alzheimer's disease", 'alzheimers', 'AD', 'dementia', 'cognitive decline'],
    "alzheimer's": ["alzheimer's disease", 'alzheimers', 'AD', 'dementia', 'amyloid'],
    'parkinson': ["parkinson's disease", 'parkinsons', 'PD', 'dopaminergic', 'alpha-synuclein'],
    "parkinson's": ["parkinson's disease", 'parkinsons', 'PD', 'lewy body'],
    'stroke': ['cerebrovascular accident', 'CVA', 'ischemic stroke', 'hemorrhagic stroke'],
    'depression': ['major depressive disorder', 'MDD', 'clinical depression', 'unipolar depression'],
    'anxiety': ['generalized anxiety disorder', 'GAD', 'anxiety disorder', 'panic disorder'],
    'asthma': ['bronchial asthma', 'reactive airway disease', 'bronchospasm'],
    'arthritis': ['rheumatoid arthritis', 'osteoarthritis', 'RA', 'joint inflammation'],
    'rheumatoid arthritis': ['RA', 'inflammatory arthritis', 'autoimmune arthritis'],
    'kidney disease': ['chronic kidney disease', 'CKD', 'renal failure', 'nephropathy'],
    'liver disease': ['hepatic disease', 'cirrhosis', 'liver failure', 'hepatitis'],
    'heart disease': ['cardiovascular disease', 'coronary artery disease', 'CAD', 'heart failure'],
    'covid': ['COVID-19', 'SARS-CoV-2', 'coronavirus', 'post-COVID', 'long COVID'],
    'covid-19': ['SARS-CoV-2', 'coronavirus disease', 'long COVID', 'post-acute sequelae'],
    'multiple sclerosis': ['MS', 'demyelinating disease', 'autoimmune neurological'],
    'breast cancer': ['mammary carcinoma', 'HER2', 'triple-negative breast cancer', 'TNBC'],
    'prostate cancer': ['prostatic carcinoma', 'PSA', 'androgen deprivation therapy'],
    'leukemia': ['acute myeloid leukemia', 'AML', 'chronic lymphocytic leukemia', 'CLL'],
    'hiv': ['HIV/AIDS', 'antiretroviral therapy', 'ART', 'immunodeficiency'],
    'tuberculosis': ['TB', 'mycobacterium tuberculosis', 'pulmonary tuberculosis'],
  }
};
