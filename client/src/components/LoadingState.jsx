import React from 'react';

const STEPS = [
  { icon: '🧠', text: 'Expanding query with AI...', color: '#8B5CF6' },
  { icon: '🔍', text: 'Searching PubMed, OpenAlex & ClinicalTrials.gov...', color: '#3B82F6' },
  { icon: '📊', text: 'Ranking & filtering results...', color: '#F59E0B' },
  { icon: '🤖', text: 'Generating insights with Llama 3 70B...', color: '#D97757' },
];

/**
 * LoadingState component
 * - step: current active step (1-4), server-driven via SSE
 * - stepMessage: live message text from server SSE 'step' event
 */
export default function LoadingState({ step = 1, stepMessage = '' }) {
  const progress = ((step - 1) / STEPS.length) * 100;

  return (
    <div className="loading-container">
      <div className="message assistant">
        <div className="message-avatar">✦</div>
        <div className="message-content">
          <div className="loading-card">
            {/* Progress bar */}
            <div className="loading-progress-track">
              <div
                className="loading-progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Steps */}
            <div className="loading-steps">
              {STEPS.map((s, i) => {
                const stepNum = i + 1;
                const isActive = stepNum === step;
                const isDone = stepNum < step;
                return (
                  <div
                    key={i}
                    className={`loading-step-v2 ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}
                  >
                    <div className="step-indicator">
                      {isDone ? (
                        <div className="step-check">
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                            <path d="M3 8.5L6.5 12L13 4" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                      ) : isActive ? (
                        <div className="step-spinner" style={{ borderTopColor: s.color }} />
                      ) : (
                        <div className="step-dot" />
                      )}
                    </div>
                    <div className="step-content">
                      <span className={`step-text-v2 ${isDone ? 'done' : ''}`}>
                        {isActive && stepMessage ? stepMessage : s.text}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
