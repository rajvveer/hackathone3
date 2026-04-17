import React, { useState } from 'react';
import Typewriter from './Typewriter';

const STATUS_CLASS = {
  'RECRUITING': 'recruiting',
  'ACTIVE_NOT_RECRUITING': 'active',
  'COMPLETED': 'completed',
  'NOT_YET_RECRUITING': 'pending',
  'ENROLLING_BY_INVITATION': 'active',
  'SUSPENDED': 'suspended',
  'TERMINATED': 'suspended',
};

export default function MessageBubble({ message }) {
  const [expandedEligibility, setExpandedEligibility] = useState({});

  if (message.role === 'user') {
    return (
      <div className="message user">
        <div className="message-content">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.isError) {
    return (
      <div className="message assistant">
        <div className="message-avatar">✦</div>
        <div className="message-content">
          <div className="message-bubble">
            <div className="response-section error-section">
              <p>⚠️ {message.content}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const r = message.response;
  const metrics = message.pipelineMetrics;

  if (!r) {
    return (
      <div className="message assistant">
        <div className="message-avatar">✦</div>
        <div className="message-content">
          <div className="message-bubble">
            <div className="response-section"><p>
              <Typewriter text={message.content} disabled={!message.isNew} speed={6} />
            </p></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="message assistant">
      <div className="message-avatar">✦</div>
      <div className="message-content">
        <div className="message-bubble">

          {/* ── Condition Overview ───────────────────────────── */}
          {r.conditionOverview && (
            <div className="response-section">
              <div className="response-section-header">
                <h3>Condition Overview</h3>
              </div>
              <p>
                <Typewriter text={r.conditionOverview} disabled={!message.isNew} speed={6} delay={0} />
              </p>
            </div>
          )}

          {/* ── Research Insights ────────────────────────────── */}
          {r.researchInsights && (
            <div className="response-section">
              <div className="response-section-header">
                <h3>Research Insights</h3>
              </div>
              <p>
                <Typewriter text={r.researchInsights} disabled={!message.isNew} speed={6} delay={300} />
              </p>
            </div>
          )}

          {/* ── Key Findings ─────────────────────────────────── */}
          {r.keyFindings && r.keyFindings.length > 0 && (
            <div className="response-section">
              <div className="response-section-header">
                <h3>Key Findings</h3>
              </div>
              <ul className="key-findings">
                {r.keyFindings.map((finding, i) => (
                  <li key={i}>{finding}</li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Publications ─────────────────────────────────── */}
          {r.publications && r.publications.length > 0 && (
            <div className="response-section">
              <div className="response-section-header">
                <h3>Top Publications ({r.publications.length})</h3>
              </div>
              <div className="cards-grid">
                {r.publications.map((pub, i) => (
                  <div key={i} className="pub-card">
                    <div className="pub-title">
                      <a href={pub.url} target="_blank" rel="noopener noreferrer">
                        {pub.title}
                      </a>
                    </div>
                    <div className="pub-meta">
                      <span className="badge badge-year">{pub.year}</span>
                      <span className="badge badge-source">{pub.source}</span>
                      {pub.isOpenAccess && <span className="badge badge-oa">🔓 Open Access</span>}
                      {pub.citationCount > 0 && (
                        <span className="badge badge-citations">📝 {pub.citationCount.toLocaleString()} citations</span>
                      )}
                      {pub.relevanceScore > 0 && (
                        <span className="badge badge-score">⭐ {pub.relevanceScore.toFixed(2)}</span>
                      )}
                    </div>
                    {pub.authors && pub.authors.length > 0 && (
                      <div className="pub-authors">
                        {pub.authors.slice(0, 3).join(', ')}
                        {pub.authors.length > 3 ? ` +${pub.authors.length - 3} more` : ''}
                      </div>
                    )}
                    {pub.sourceJournal && pub.sourceJournal !== 'Unknown Source' && (
                      <div className="pub-journal">{pub.sourceJournal}</div>
                    )}
                    {pub.abstract && (
                      <div className="pub-abstract">{pub.abstract}</div>
                    )}
                    {pub.topics && pub.topics.length > 0 && (
                      <div className="pub-topics">
                        {pub.topics.map((t, j) => (
                          <span key={j} className="topic-tag">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Clinical Trials ──────────────────────────────── */}
          {r.clinicalTrials && r.clinicalTrials.length > 0 && (
            <div className="response-section">
              <div className="response-section-header">
                <h3>Clinical Trials ({r.clinicalTrials.length})</h3>
              </div>
              <div className="cards-grid">
                {r.clinicalTrials.map((trial, i) => {
                  const isExpanded = expandedEligibility[i];
                  return (
                    <div key={i} className="trial-card">
                      <div className="trial-header">
                        <div className="trial-title">
                          <a href={trial.url} target="_blank" rel="noopener noreferrer">
                            {trial.title}
                          </a>
                        </div>
                        <span className={`status-badge ${STATUS_CLASS[trial.status] || 'active'}`}>
                          {trial.status?.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="trial-details">
                        {trial.phase && trial.phase !== 'N/A' && (
                          <div className="trial-detail">
                            <span className="label">Phase:</span>
                            <span>{trial.phase}</span>
                          </div>
                        )}
                        {trial.sponsor && (
                          <div className="trial-detail">
                            <span className="label">Sponsor:</span>
                            <span>{trial.sponsor}</span>
                          </div>
                        )}
                        {trial.enrollmentCount > 0 && (
                          <div className="trial-detail">
                            <span className="label">Enrollment:</span>
                            <span>{trial.enrollmentCount.toLocaleString()} participants</span>
                          </div>
                        )}
                        {trial.location && trial.location !== 'Location not specified' && (
                          <div className="trial-detail">
                            <span className="label">Location:</span>
                            <span>{trial.location.substring(0, 180)}</span>
                          </div>
                        )}
                        {trial.contact && trial.contact !== 'Contact not available' && (
                          <div className="trial-detail">
                            <span className="label">Contact:</span>
                            <span>{trial.contact.substring(0, 150)}</span>
                          </div>
                        )}
                        {/* Eligibility — required by hackathon spec */}
                        {trial.eligibility && (
                          <div className="trial-eligibility">
                            <div className="eligibility-header">
                              <span className="label">Eligibility Criteria:</span>
                              <button
                                className="eligibility-toggle"
                                onClick={() => setExpandedEligibility(prev => ({ ...prev, [i]: !prev[i] }))}
                              >
                                {isExpanded ? 'Show less ▲' : 'Show more ▼'}
                              </button>
                            </div>
                            <div className={`eligibility-text ${isExpanded ? 'expanded' : ''}`}>
                              {trial.eligibility}
                            </div>
                          </div>
                        )}
                        {trial.summary && (
                          <div className="trial-detail" style={{ marginTop: 6 }}>
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                              {trial.summary}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Clinical Trials Summary (LLM generated) ─────── */}
          {r.clinicalTrialsSummary && (
            <div className="response-section">
              <div className="response-section-header">
                <h3>Clinical Trials Summary</h3>
              </div>
              <p>
                <Typewriter text={r.clinicalTrialsSummary} disabled={!message.isNew} speed={6} delay={600} />
              </p>
            </div>
          )}

          {/* ── Top Researchers ──────────────────────────────── */}
          {r.researchers && r.researchers.length > 0 && (
            <div className="response-section">
              <div className="response-section-header">
                <h3>Top Researchers ({r.researchers.length})</h3>
              </div>
              <div className="cards-grid">
                {r.researchers.map((researcher, i) => (
                  <div key={i} className="researcher-card">
                    <div className="researcher-rank">#{i + 1}</div>
                    <div className="researcher-info">
                      <div className="researcher-name">
                        {researcher.url
                          ? <a href={researcher.url} target="_blank" rel="noopener noreferrer">{researcher.name}</a>
                          : researcher.name
                        }
                      </div>
                      <div className="researcher-institution">{researcher.institution}</div>
                      <div className="researcher-meta">
                        <span className="badge badge-citations">📝 {researcher.citationCount?.toLocaleString()} citations</span>
                        <span className="badge badge-score">📊 h-index: {researcher.hIndex}</span>
                        <span className="badge badge-year">📄 {researcher.worksCount} works</span>
                      </div>
                      {researcher.topics && researcher.topics.length > 0 && (
                        <div className="researcher-topics">
                          {researcher.topics.map((t, j) => (
                            <span key={j} className="topic-tag">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Personalized Recommendation ──────────────────── */}
          {r.personalizedRecommendation && (
            <div className="response-section recommendation-section">
              <div className="response-section-header">
                <h3>Personalized Recommendation</h3>
              </div>
              <p>
                <Typewriter text={r.personalizedRecommendation} disabled={!message.isNew} speed={6} delay={900} />
              </p>
            </div>
          )}

          {/* ── Pipeline Metrics ─────────────────────────────── */}
          {metrics && (
            <div className="pipeline-metrics">
              <div className="metric">
                <span className="metric-value">{metrics.totalRetrieved || 0}</span>
                <span className="metric-label">Retrieved</span>
              </div>
              <div className="metric">
                <span className="metric-value">{metrics.selectedPublications || 0}</span>
                <span className="metric-label">Top Pubs</span>
              </div>
              <div className="metric">
                <span className="metric-value">{metrics.selectedTrials || 0}</span>
                <span className="metric-label">Top Trials</span>
              </div>
              <div className="metric">
                <span className="metric-value">{metrics.totalTimeMs ? `${(metrics.totalTimeMs / 1000).toFixed(1)}s` : '—'}</span>
                <span className="metric-label">Total Time</span>
              </div>
              <div className="metric">
                <span className="metric-value">{metrics.llmTimeMs ? `${(metrics.llmTimeMs / 1000).toFixed(1)}s` : '—'}</span>
                <span className="metric-label">LLM Time</span>
              </div>
              {metrics.fromCache && (
                <div className="metric">
                  <span className="metric-value" style={{ color: '#34d399' }}>⚡ {metrics.fromCache}</span>
                  <span className="metric-label">Cache Hit</span>
                </div>
              )}
              {metrics.expandedQueries && metrics.expandedQueries.length > 0 && (
                <div className="metric-queries">
                  <span className="metric-label" style={{ marginBottom: 4, display: 'block' }}>Expanded Queries</span>
                  {metrics.expandedQueries.map((q, i) => (
                    <span key={i} className="pipeline-query-tag small">{q}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
