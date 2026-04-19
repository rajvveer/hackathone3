import React, { useState, useRef, useEffect } from 'react';
import Typewriter from './Typewriter';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix leaflet default icon issues
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const STATUS_CLASS = {
  'RECRUITING': 'recruiting',
  'ACTIVE_NOT_RECRUITING': 'active',
  'COMPLETED': 'completed',
  'NOT_YET_RECRUITING': 'pending',
  'ENROLLING_BY_INVITATION': 'active',
  'SUSPENDED': 'suspended',
  'TERMINATED': 'suspended',
};

const STATUS_ICON = {
  'RECRUITING': '🟢',
  'ACTIVE_NOT_RECRUITING': '🔵',
  'COMPLETED': '✅',
  'NOT_YET_RECRUITING': '🟡',
  'ENROLLING_BY_INVITATION': '🔵',
  'SUSPENDED': '🟠',
  'TERMINATED': '🔴',
};

/* ── Smooth-collapsing wrapper ──────────────────────────── */
function CollapsibleSection({ title, icon, count, children, defaultOpen = false, delay = 0 }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [height, setHeight] = useState(defaultOpen ? 'auto' : '0px');
  const [visible, setVisible] = useState(false);
  const contentRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  useEffect(() => {
    if (!contentRef.current) return;
    if (isOpen) {
      setHeight(`${contentRef.current.scrollHeight}px`);
      // After transition, set to auto so inner content can resize
      const t = setTimeout(() => setHeight('auto'), 350);
      return () => clearTimeout(t);
    } else {
      // First set explicit height, then collapse
      setHeight(`${contentRef.current.scrollHeight}px`);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setHeight('0px'));
      });
    }
  }, [isOpen]);

  return (
    <div className={`collapsible-section-v2 ${visible ? 'visible' : ''}`}>
      <button
        className={`collapsible-header ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <div className="collapsible-header-left">
          <span className="collapsible-icon">{icon}</span>
          <span className="collapsible-title">{title}</span>
          {count !== undefined && (
            <span className="collapsible-count">{count}</span>
          )}
        </div>
        <span className={`collapsible-chevron ${isOpen ? 'open' : ''}`}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      </button>
      <div
        className="collapsible-body"
        style={{ height, overflow: height === 'auto' ? 'visible' : 'hidden' }}
        ref={contentRef}
      >
        <div className="collapsible-body-inner">
          {children}
        </div>
      </div>
    </div>
  );
}

/* ── Copy button ─────────────────────────────────────────── */
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* noop */ }
  };

  return (
    <button className="copy-btn" onClick={handleCopy} title="Copy to clipboard">
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 8.5L6.5 11L12 5" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M3 11V3.5A1.5 1.5 0 014.5 2H11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
      )}
    </button>
  );
}

/* ── Clinical Trials Heatmap ─────────────────────────────── */
function ClinicalTrialsHeatmap({ trials }) {
  const [markers, setMarkers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const fetchCoords = async () => {
      const locations = trials
        .map(t => t.location)
        .filter(loc => loc && loc.length > 3 && loc !== 'Location not specified');
      
      const uniqueLocs = [...new Set(locations)].slice(0, 15); // max 15 to keep it fast

      if (uniqueLocs.length === 0) {
        if(mounted) setLoading(false);
        return;
      }

      try {
        const res = await fetch('/api/chat/heatmap-coords', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locations: uniqueLocs })
        });
        if (res.ok) {
          const data = await res.json();
          if (mounted) {
            const enrichedMarkers = [];
            trials.forEach(trial => {
               const match = data.find(d => d.location === trial.location);
               if (match && match.lat && match.lng) {
                  enrichedMarkers.push({ ...trial, lat: match.lat, lng: match.lng });
               }
            });
            
            const seen = {};
            const finalMarkers = enrichedMarkers.map(m => {
               const key = `${Math.round(m.lat*100)},${Math.round(m.lng*100)}`;
               if (seen[key]) {
                  seen[key] += 1;
                  return { ...m, lat: m.lat + (seen[key] * 0.05), lng: m.lng + (seen[key] * 0.05) };
               } else {
                  seen[key] = 1;
                  return m;
               }
            });
            setMarkers(finalMarkers);
          }
        }
      } catch (err) {
        console.error('Heatmap load error', err);
      } finally {
        if(mounted) setLoading(false);
      }
    };
    fetchCoords();
    return () => { mounted = false; };
  }, [trials]);

/* ── Map Bounds Auto-fitter ────────────────────────────── */
function MapBounds({ markers }) {
  const map = useMap();
  useEffect(() => {
    if (markers && markers.length > 0) {
      const bounds = L.latLngBounds(markers.map(m => [m.lat, m.lng]));
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 6 });
    }
  }, [markers, map]);
  return null;
}

  if (loading) {
    return <div className="heatmap-loading"><div className="heatmap-pulse"></div> Generating Global Distribution...</div>;
  }

  if (markers.length === 0) return null;

  return (
    <div className="trials-heatmap-container fade-in-section">
      <div className="section-label">
        <span className="section-label-icon">🗺️</span> Global Trial Distribution
      </div>
      <MapContainer center={[20, 0]} zoom={2} scrollWheelZoom={true} className="trials-map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        />
        <MapBounds markers={markers} />
        {markers.map((loc, i) => {
          const customIcon = L.divIcon({
            html: `<div style="font-size: 22px; text-shadow: 0 2px 4px rgba(0,0,0,0.4); line-height: 1;">${STATUS_ICON[loc.status] || '📍'}</div>`,
            className: 'custom-trial-marker',
            iconSize: [24, 24],
            iconAnchor: [12, 12]
          });

          return (
            <Marker key={i} position={[loc.lat, loc.lng]} icon={customIcon}>
              <Popup className="trial-custom-popup">
                <div style={{ padding: '2px', maxWidth: '240px' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '6px', lineHeight: 1.3 }}>{loc.title}</div>
                  <div style={{ fontSize: '11px', color: '#666', marginBottom: '8px', lineHeight: 1.2 }}>{loc.location}</div>
                  <div style={{ fontSize: '11px', fontWeight: 600 }}>
                    <span className={`status-pill ${STATUS_CLASS[loc.status] || 'active'}`} style={{ padding: '2px 6px', fontSize: '10px' }}>
                      {STATUS_ICON[loc.status] || '⚪'} {loc.status?.replace(/_/g, ' ') || 'Unknown'}
                    </span>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}

/* ── Publication Card ────────────────────────────────────── */
function PublicationCard({ pub, index }) {
  const [showAbstract, setShowAbstract] = useState(false);

  return (
    <div className="pub-card-v2" style={{ animationDelay: `${index * 60}ms` }}>
      <div className="pub-card-header">
        <div className="pub-number">{index + 1}</div>
        <div className="pub-card-content">
          <a href={pub.url} target="_blank" rel="noopener noreferrer" className="pub-title-link">
            {pub.title}
          </a>
          <div className="pub-meta-row">
            {pub.year && <span className="meta-chip year">{pub.year}</span>}
            {pub.source && <span className="meta-chip source">{pub.source}</span>}
            {pub.isOpenAccess && <span className="meta-chip oa">🔓 Open Access</span>}
            {pub.citationCount > 0 && (
              <span className="meta-chip citations">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 12V7M8 12V4M13 12V1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                {pub.citationCount.toLocaleString()}
              </span>
            )}
            {pub.relevanceScore > 0 && (
              <span className="meta-chip relevance">
                ⭐ {(pub.relevanceScore * 100).toFixed(0)}%
              </span>
            )}
          </div>
          {pub.authors && pub.authors.length > 0 && (
            <div className="pub-authors-v2">
              {pub.authors.slice(0, 3).join(', ')}
              {pub.authors.length > 3 ? ` +${pub.authors.length - 3} more` : ''}
            </div>
          )}
          {pub.sourceJournal && pub.sourceJournal !== 'Unknown Source' && (
            <div className="pub-journal-v2">{pub.sourceJournal}</div>
          )}
          {pub.abstract && (
            <div className="pub-abstract-wrapper">
              <button className="abstract-toggle" onClick={() => setShowAbstract(!showAbstract)}>
                {showAbstract ? 'Hide Abstract ▲' : 'Show Abstract ▼'}
              </button>
              {showAbstract && (
                <div className="pub-abstract-v2">{pub.abstract}</div>
              )}
            </div>
          )}
          {pub.topics && pub.topics.length > 0 && (
            <div className="pub-topics-v2">
              {pub.topics.map((t, j) => (
                <span key={j} className="topic-chip">{t}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Trial Card ──────────────────────────────────────────── */
function TrialCard({ trial, index, conversationId }) {
  const [activeTab, setActiveTab] = useState('details');
  const [matchState, setMatchState] = useState(null);
  const [followUpAnswer, setFollowUpAnswer] = useState({});

  const statusLabel = trial.status?.replace(/_/g, ' ') || 'Unknown';
  const statusIcon = STATUS_ICON[trial.status] || '⚪';

  const checkEligibility = async (additionalContext = '') => {
    setMatchState('loading');
    try {
      const res = await fetch('/api/chat/trial-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criteria: trial.eligibility, conversationId, additionalContext })
      });
      const data = await res.json();
      if (res.ok) {
        setMatchState(data);
        setFollowUpAnswer('');
      } else {
        setMatchState({ error: data.error || 'Failed to check match' });
      }
    } catch {
      setMatchState({ error: 'Network error checking eligibility' });
    }
  };

  return (
    <div className="trial-card-v2" style={{ animationDelay: `${index * 80}ms` }}>
      {/* Header */}
      <div className="trial-card-top">
        <div className="trial-status-row">
          <span className={`status-pill ${STATUS_CLASS[trial.status] || 'active'}`}>
            {statusIcon} {statusLabel}
          </span>
          {trial.phase && trial.phase !== 'N/A' && (
            <span className="phase-pill">{trial.phase}</span>
          )}
        </div>
        <a href={trial.url} target="_blank" rel="noopener noreferrer" className="trial-title-link">
          {trial.title}
        </a>
      </div>

      {/* Tabs */}
      <div className="trial-tabs">
        <button
          className={`trial-tab ${activeTab === 'details' ? 'active' : ''}`}
          onClick={() => setActiveTab('details')}
        >
          Details
        </button>
        <button
          className={`trial-tab ${activeTab === 'eligibility' ? 'active' : ''}`}
          onClick={() => setActiveTab('eligibility')}
          disabled={!trial.eligibility}
        >
          Eligibility
        </button>
        {trial.summary && (
          <button
            className={`trial-tab ${activeTab === 'summary' ? 'active' : ''}`}
            onClick={() => setActiveTab('summary')}
          >
            Summary
          </button>
        )}
      </div>

      {/* Tab Content */}
      <div className="trial-tab-content">
        {activeTab === 'details' && (
          <div className="trial-details-grid">
            {trial.sponsor && (
              <div className="detail-item">
                <span className="detail-icon">🏢</span>
                <div>
                  <span className="detail-label">Sponsor</span>
                  <span className="detail-value">{trial.sponsor}</span>
                </div>
              </div>
            )}
            {trial.enrollmentCount > 0 && (
              <div className="detail-item">
                <span className="detail-icon">👥</span>
                <div>
                  <span className="detail-label">Enrollment</span>
                  <span className="detail-value">{trial.enrollmentCount.toLocaleString()} participants</span>
                </div>
              </div>
            )}
            {trial.location && trial.location !== 'Location not specified' && (
              <div className="detail-item">
                <span className="detail-icon">📍</span>
                <div>
                  <span className="detail-label">Location</span>
                  <span className="detail-value">{trial.location.substring(0, 180)}</span>
                </div>
              </div>
            )}
            {trial.contact && trial.contact !== 'Contact not available' && (
              <div className="detail-item">
                <span className="detail-icon">📧</span>
                <div>
                  <span className="detail-label">Contact</span>
                  <span className="detail-value">{trial.contact.substring(0, 150)}</span>
                </div>
              </div>
            )}
          </div>
        )}
        {activeTab === 'eligibility' && trial.eligibility && (
          <div className="trial-eligibility-v2">
            <div className="eligibility-matcher">
              {!matchState && (
                <button className="match-btn" onClick={() => checkEligibility('')}>
                  <span className="match-icon">🧬</span> Am I Eligible?
                </button>
              )}
              {matchState === 'loading' && (
                <div className="match-loading">
                  <div className="match-pulse"></div>
                  <span>AI Analyzing trial criteria against your profile...</span>
                </div>
              )}
              {matchState && matchState !== 'loading' && !matchState.error && (
                <div className={`match-result ${matchState.isEligible ? 'eligible' : 'ineligible'}`}>
                  <div className="match-result-header">
                    <span className="match-result-icon">{matchState.isEligible ? '✅' : '⚠️'}</span>
                    <span className="match-result-title">
                      {matchState.isEligible ? 'Likely Eligible' : 'Ineligible or Needs Info'}
                    </span>
                  </div>
                  <p className="match-result-reasoning">{matchState.reasoning}</p>
                  
                  {matchState.missingQuestions && matchState.missingQuestions.length > 0 && (
                    <div className="match-followup-section fade-in-section">
                      <div className="match-followup-header">
                        <div className="match-followup-icon">✨</div>
                        <span className="match-followup-title">AI Needs Clarification to Verify Eligibility</span>
                      </div>
                      <div className="match-followup-form">
                        {matchState.missingQuestions.map((q, i) => (
                          <div key={i} className="followup-qa-pair">
                            <label className="followup-question-label">{q}</label>
                            <input 
                              type="text" 
                              className="followup-specific-input"
                              placeholder="Your answer..."
                              value={followUpAnswer[i] || ''}
                              onChange={(e) => setFollowUpAnswer({ ...followUpAnswer, [i]: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const ans = Object.values(followUpAnswer).filter(v => v.trim()).join(', ');
                                  if (ans) checkEligibility(ans);
                                }
                              }}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="match-followup-actions">
                        <button 
                          className={`followup-submit-btn ${Object.keys(followUpAnswer).length > 0 ? 'active' : ''}`}
                          onClick={() => {
                            const combinedAnswers = matchState.missingQuestions
                              .map((q, i) => followUpAnswer[i] ? `Q: ${q} A: ${followUpAnswer[i]}` : '')
                              .filter(Boolean)
                              .join(' | ');
                            if (combinedAnswers) checkEligibility(combinedAnswers);
                          }}
                          disabled={Object.keys(followUpAnswer).length === 0}
                        >
                          Verify Eligibility
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {matchState?.error && (
                <div className="match-error">⚠️ {matchState.error}</div>
              )}
            </div>
            <div className="eligibility-text">
              {trial.eligibility}
            </div>
          </div>
        )}
        {activeTab === 'summary' && trial.summary && (
          <div className="trial-summary-v2">
            {trial.summary}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Researcher Card ─────────────────────────────────────── */
function ResearcherCard({ researcher, index }) {
  return (
    <div className="researcher-card-v2" style={{ animationDelay: `${index * 60}ms` }}>
      <div className="researcher-avatar">
        <span className="researcher-initial">{researcher.name?.charAt(0) || '?'}</span>
        <span className="researcher-rank-badge">#{index + 1}</span>
      </div>
      <div className="researcher-info-v2">
        <div className="researcher-name-v2">
          {researcher.url
            ? <a href={researcher.url} target="_blank" rel="noopener noreferrer">{researcher.name}</a>
            : researcher.name
          }
        </div>
        {researcher.institution && (
          <div className="researcher-institution-v2">{researcher.institution}</div>
        )}
        <div className="researcher-stats">
          {researcher.citationCount != null && (
            <div className="stat-item">
              <span className="stat-value">{researcher.citationCount?.toLocaleString()}</span>
              <span className="stat-label">Citations</span>
            </div>
          )}
          {researcher.hIndex != null && (
            <div className="stat-item">
              <span className="stat-value">{researcher.hIndex}</span>
              <span className="stat-label">h-index</span>
            </div>
          )}
          {researcher.worksCount != null && (
            <div className="stat-item">
              <span className="stat-value">{researcher.worksCount}</span>
              <span className="stat-label">Works</span>
            </div>
          )}
        </div>
        {researcher.topics && researcher.topics.length > 0 && (
          <div className="researcher-topics-v2">
            {researcher.topics.map((t, j) => (
              <span key={j} className="topic-chip">{t}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Metrics Bar ─────────────────────────────────────────── */
function MetricsBar({ metrics, onFollowUp }) {
  if (!metrics) return null;
  const items = [
    { value: metrics.totalRetrieved || 0, label: 'Retrieved', icon: '📥' },
    { value: metrics.selectedPublications || 0, label: 'Top Pubs', icon: '📚' },
    { value: metrics.selectedTrials || 0, label: 'Trials', icon: '🧪' },
  ];

  return (
    <div className="metrics-bar-v2">
      <div className="metrics-row">
        {items.map((item, i) => (
          <div key={i} className="metric-item-v2">
            <span className="metric-icon-v2">{item.icon}</span>
            <span className="metric-value-v2">{item.value}</span>
            <span className="metric-label-v2">{item.label}</span>
          </div>
        ))}
      </div>
      {metrics.expandedQueries && metrics.expandedQueries.length > 0 && (
        <div className="metrics-queries-v2">
          <span className="queries-label">Expanded Queries</span>
          <div className="queries-list">
            {metrics.expandedQueries.map((q, i) => (
              <span 
                key={i} 
                className="query-chip"
                style={{ cursor: 'pointer', transition: 'all 0.2s' }}
                onClick={() => onFollowUp && onFollowUp(q)}
                title="Search this query"
              >
                {q}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
/* ██ MAIN MESSAGE BUBBLE                                  ██ */
/* ══════════════════════════════════════════════════════════ */
export default function MessageBubble({ message, conversationId, onFollowUp }) {
  const [copied, setCopied] = useState(false);

  if (message.role === 'user') {
    return (
      <div className="message user">
        <div className="message-content">
          {message.content}
          {message.fileAttachment && (
            <div className="user-file-attachment">
              {message.fileAttachment.isImage || message.fileAttachment.url ? (
                <div className="file-thumb">
                  {message.fileAttachment.url ? (
                    <img src={message.fileAttachment.url} alt={message.fileAttachment.name} />
                  ) : (
                    <span className="file-thumb-icon">🖼️</span>
                  )}
                </div>
              ) : (
                <div className="file-thumb">
                  <span className="file-thumb-icon">📄</span>
                </div>
              )}
              <span className="file-attach-name">{message.fileAttachment.name}</span>
            </div>
          )}
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
            <div className="error-banner">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="#ef4444" strokeWidth="1.5"/><path d="M8 4.5V8.5M8 10.5V11" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"/></svg>
              <span>{message.content}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const r = message.response;
  const metrics = message.pipelineMetrics;

  // ── File Analysis Response ────────────────────────────────
  if (r && r.isFileAnalysis) {
    const statusColors = {
      normal: '#34d399',
      elevated: '#fbbf24',
      low: '#60a5fa',
      critical: '#ef4444',
    };

    return (
      <div className="message assistant">
        <div className="message-avatar">✦</div>
        <div className="message-content">
          <div className="message-bubble">
            <div className="response-actions-bar">
              <CopyButton text={[r.summary, r.recommendations, r.abnormalValues?.join('\n')].filter(Boolean).join('\n\n')} />
            </div>

            {/* Document Type Badge */}
            {r.documentType && (
              <div className="file-analysis-header fade-in-section" style={{ animationDelay: '0ms' }}>
                <div className="doc-type-badge">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <polyline points="14,2 14,8 20,8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span>{r.documentType}</span>
                </div>
                {r.fileInfo?.url && (
                  <a href={r.fileInfo.url} target="_blank" rel="noopener noreferrer" className="view-original-link">
                    View Original ↗
                  </a>
                )}
              </div>
            )}

            {/* Summary */}
            {r.summary && (
              <div className="response-section-v2 fade-in-section" style={{ animationDelay: '50ms' }}>
                <div className="section-label">
                  <span className="section-label-icon">📋</span>
                  Summary
                </div>
                <p><Typewriter text={r.summary} disabled={!message.isNew} speed={6} delay={0} /></p>
              </div>
            )}

            {/* Key Findings Table */}
            {r.keyFindings && r.keyFindings.length > 0 && (
              <div className="response-section-v2 fade-in-section" style={{ animationDelay: '150ms' }}>
                <div className="section-label">
                  <span className="section-label-icon">🔬</span>
                  Key Findings
                </div>
                <div className="findings-table-wrapper">
                  <table className="findings-table">
                    <thead>
                      <tr>
                        <th>Parameter</th>
                        <th>Value</th>
                        <th>Reference</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.keyFindings.map((f, i) => (
                        <tr key={i} className={`finding-row ${f.status || ''}`}>
                          <td className="finding-param">{f.parameter}</td>
                          <td className="finding-value">{f.value}</td>
                          <td className="finding-ref">{f.referenceRange || '—'}</td>
                          <td>
                            <span
                              className={`finding-status-badge ${f.status || 'normal'}`}
                              style={{ color: statusColors[f.status] || statusColors.normal }}
                            >
                              {f.status === 'critical' ? '⚠️ ' : ''}{f.status || 'normal'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Explanations */}
                {r.keyFindings.some(f => f.explanation) && (
                  <div className="findings-explanations">
                    {r.keyFindings.filter(f => f.explanation && f.status !== 'normal').map((f, i) => (
                      <div key={i} className="finding-explanation-item">
                        <span className="finding-exp-label" style={{ color: statusColors[f.status] || '#94a3b8' }}>
                          {f.parameter}:
                        </span>
                        <span className="finding-exp-text">{f.explanation}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Abnormal Values */}
            {r.abnormalValues && r.abnormalValues.length > 0 && (
              <div className="response-section-v2 fade-in-section abnormal-section" style={{ animationDelay: '250ms' }}>
                <div className="section-label">
                  <span className="section-label-icon">⚠️</span>
                  Abnormal Values
                </div>
                <ul className="abnormal-list">
                  {r.abnormalValues.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Medications */}
            {r.medications && r.medications.length > 0 && (
              <div className="response-section-v2 fade-in-section" style={{ animationDelay: '350ms' }}>
                <div className="section-label">
                  <span className="section-label-icon">💊</span>
                  Medications
                </div>
                <div className="medications-list">
                  {r.medications.map((med, i) => (
                    <span key={i} className="medication-chip">{med}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Recommendations */}
            {r.recommendations && (
              <div className="response-section-v2 recommendation-section-v2 fade-in-section" style={{ animationDelay: '450ms' }}>
                <div className="section-label">
                  <span className="section-label-icon">🎯</span>
                  Recommendations
                </div>
                <p><Typewriter text={r.recommendations} disabled={!message.isNew} speed={6} delay={500} /></p>
              </div>
            )}

            {/* Suggested Research Topics */}
            {r.suggestedResearchTopics && r.suggestedResearchTopics.length > 0 && (
              <div className="response-section-v2 fade-in-section" style={{ animationDelay: '550ms' }}>
                <div className="section-label">
                  <span className="section-label-icon">🔎</span>
                  Research These Topics
                </div>
                <div className="suggested-topics">
                  {r.suggestedResearchTopics.map((topic, i) => (
                    <span key={i} className="suggested-topic-chip">{topic}</span>
                  ))}
                </div>
              </div>
            )}

            {/* ── Publications ──────────────────────────────────── */}
            {r.publications && r.publications.length > 0 && (
              <CollapsibleSection
                title="Top Publications"
                icon="📚"
                count={r.publications.length}
                delay={600}
              >
                <div className="cards-list-v2">
                  {r.publications.map((pub, i) => (
                    <PublicationCard key={i} pub={pub} index={i} />
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {/* ── Clinical Trials ───────────────────────────────── */}
            {r.clinicalTrials && r.clinicalTrials.length > 0 && (
              <CollapsibleSection
                title="Clinical Trials"
                icon="🧪"
                count={r.clinicalTrials.length}
                delay={650}
              >
                <ClinicalTrialsHeatmap trials={r.clinicalTrials} />
                <div className="cards-list-v2">
                  {r.clinicalTrials.map((trial, i) => (
                    <TrialCard key={i} trial={trial} index={i} conversationId={conversationId} />
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {/* ── Top Researchers ───────────────────────────────── */}
            {r.researchers && r.researchers.length > 0 && (
              <CollapsibleSection
                title="Top Researchers"
                icon="👨‍🔬"
                count={r.researchers.length}
                delay={700}
              >
                <div className="cards-list-v2">
                  {r.researchers.map((researcher, i) => (
                    <ResearcherCard key={i} researcher={researcher} index={i} />
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {/* Pipeline Metrics */}
            <MetricsBar metrics={metrics} />
          </div>
        </div>
      </div>
    );
  }

  // Fallback: plain text (no structured response)
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

  // Collect full text for copy
  const fullText = [
    r.conditionOverview,
    r.researchInsights,
    r.keyFindings?.join('\n• '),
    r.clinicalTrialsSummary,
    r.personalizedRecommendation,
  ].filter(Boolean).join('\n\n');

  return (
    <div className="message assistant">
      <div className="message-avatar">✦</div>
      <div className="message-content">
        <div className="message-bubble">

          {/* ── Action bar ────────────────────────────────────── */}
          <div className="response-actions-bar">
            <CopyButton text={fullText} />
          </div>

          {/* ── Condition Overview ─────────────────────────────── */}
          {r.conditionOverview && (
            <div className="response-section-v2 fade-in-section" style={{ animationDelay: '0ms' }}>
              <div className="section-label">
                <span className="section-label-icon">📋</span>
                Condition Overview
              </div>
              <p>
                <Typewriter text={r.conditionOverview} disabled={!message.isNew} speed={6} delay={0} />
              </p>
            </div>
          )}

          {/* ── Research Insights ──────────────────────────────── */}
          {r.researchInsights && (
            <div className="response-section-v2 fade-in-section" style={{ animationDelay: '100ms' }}>
              <div className="section-label">
                <span className="section-label-icon">🔬</span>
                Research Insights
              </div>
              <p>
                <Typewriter text={r.researchInsights} disabled={!message.isNew} speed={6} delay={300} />
              </p>
            </div>
          )}

          {/* ── Key Findings ──────────────────────────────────── */}
          {r.keyFindings && r.keyFindings.length > 0 && (
            <div className="response-section-v2 fade-in-section" style={{ animationDelay: '200ms' }}>
              <div className="section-label">
                <span className="section-label-icon">💡</span>
                Key Findings
              </div>
              <ul className="key-findings-v2">
                {r.keyFindings.map((finding, i) => (
                  <li key={i}>
                    <span className="finding-bullet" />
                    <span>{finding}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Publications ──────────────────────────────────── */}
          {r.publications && r.publications.length > 0 && (
            <CollapsibleSection
              title="Top Publications"
              icon="📚"
              count={r.publications.length}
              delay={300}
            >
              <div className="cards-list-v2">
                {r.publications.map((pub, i) => (
                  <PublicationCard key={i} pub={pub} index={i} />
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* ── Clinical Trials ───────────────────────────────── */}
          {r.clinicalTrials && r.clinicalTrials.length > 0 && (
            <CollapsibleSection
              title="Clinical Trials"
              icon="🧪"
              count={r.clinicalTrials.length}
              delay={400}
            >
              <ClinicalTrialsHeatmap trials={r.clinicalTrials} />
              <div className="cards-list-v2">
                {r.clinicalTrials.map((trial, i) => (
                  <TrialCard key={i} trial={trial} index={i} conversationId={conversationId} />
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* ── Clinical Trials Summary ───────────────────────── */}
          {r.clinicalTrialsSummary && (
            <div className="response-section-v2 fade-in-section" style={{ animationDelay: '500ms' }}>
              <div className="section-label">
                <span className="section-label-icon">📊</span>
                Trials Summary
              </div>
              <p>
                <Typewriter text={r.clinicalTrialsSummary} disabled={!message.isNew} speed={6} delay={600} />
              </p>
            </div>
          )}

          {/* ── Top Researchers ───────────────────────────────── */}
          {r.researchers && r.researchers.length > 0 && (
            <CollapsibleSection
              title="Top Researchers"
              icon="👨‍🔬"
              count={r.researchers.length}
              delay={600}
            >
              <div className="cards-list-v2">
                {r.researchers.map((researcher, i) => (
                  <ResearcherCard key={i} researcher={researcher} index={i} />
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* ── Personalized Recommendation ────────────────────── */}
          {r.personalizedRecommendation && (
            <div className="response-section-v2 recommendation-section-v2 fade-in-section" style={{ animationDelay: '700ms' }}>
              <div className="section-label">
                <span className="section-label-icon">🎯</span>
                Personalized Recommendation
              </div>
              <p>
                <Typewriter text={r.personalizedRecommendation} disabled={!message.isNew} speed={6} delay={900} />
              </p>
            </div>
          )}

          {/* ── Suggested Follow-up Chips ─────────────────────── */}
          {r.suggestedQuestions && r.suggestedQuestions.length > 0 && onFollowUp && (
            <div className="suggested-chips-container fade-in-section" style={{ animationDelay: '1000ms' }}>
              {r.suggestedQuestions.map((q, i) => (
                <button 
                  key={i} 
                  className="suggested-chip" 
                  onClick={() => onFollowUp(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* ── Pipeline Metrics ──────────────────────────────── */}
          <MetricsBar metrics={metrics} onFollowUp={onFollowUp} />

        </div>
      </div>
    </div>
  );
}
