import React from 'react';

const DEFAULT_STEPS = [
  { icon: '🧠', text: 'Expanding query with AI...' },
  { icon: '🔍', text: 'Fetching from PubMed, OpenAlex & ClinicalTrials.gov...' },
  { icon: '📊', text: 'Ranking & filtering results...' },
  { icon: '🤖', text: 'Generating research insights with Llama 3 70B...' },
];

/**
 * LoadingState component
 * - step: current active step (1-4), server-driven via SSE
 * - stepMessage: live message text from server SSE 'step' event
 */
export default function LoadingState({ step = 1, stepMessage = '' }) {
  return (
    <div className="loading-container">
      <div className="message assistant">
        <div className="message-avatar">🧬</div>
        <div className="message-content">
          <div className="loading-steps">
            {DEFAULT_STEPS.map((s, i) => {
              const stepNum = i + 1;
              const isActive = stepNum === step;
              const isDone = stepNum < step;
              return (
                <div
                  key={i}
                  className={`loading-step ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}
                >
                  {isActive ? (
                    <div className="loading-spinner" />
                  ) : isDone ? (
                    <span className="step-icon">✅</span>
                  ) : (
                    <span className="step-icon" style={{ opacity: 0.3 }}>{s.icon}</span>
                  )}
                  <span className="step-text">
                    {/* Show live server message for active step, fallback to default */}
                    {isActive && stepMessage ? stepMessage : s.text}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
