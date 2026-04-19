import React from 'react';

export default function SettingsPage({ theme, toggleTheme, onBack }) {
  return (
    <div className="page-container fade-in-section">
      <div className="page-header">
        <button className="page-back-btn" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M19 12H5M5 12L12 19M5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back to Chat
        </button>
      </div>

      <div className="page-content center-panel">
        <h2 className="page-title">Application Settings</h2>
        
        <div className="settings-section form-card">
          <h4>Appearance</h4>
          
          <div className="settings-form-group theme-toggle-group">
            <label>Interface Theme</label>
            <button
              className={`theme-toggle large-theme-toggle ${theme === 'dark' ? 'dark' : 'light'}`}
              onClick={toggleTheme}
              aria-label="Toggle Theme"
            >
              <div className="theme-toggle-track">
                <div className="theme-toggle-thumb">
                  <span className="theme-toggle-icon">
                    {theme === 'light' ? '☀️ Light' : '🌙 Dark'}
                  </span>
                </div>
              </div>
            </button>
            <p className="settings-helper-text" style={{marginTop: '12px'}}>
              Switch between Light and Dark aesthetic modes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
