import React, { useState, useEffect } from 'react';
import { getProfile, updateProfile } from '../services/api';

export default function ProfilePage({ user, theme, toggleTheme, onBack }) {
  const [medicalProfile, setMedicalProfile] = useState({
    patientName: '', diseaseOfInterest: '', location: ''
  });
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  // Load latest from DB when mounted
  useEffect(() => {
    if (user) {
      getProfile().then(data => {
        if (data.medicalProfile) {
          setMedicalProfile({
            patientName: data.medicalProfile.patientName || '',
            diseaseOfInterest: data.medicalProfile.diseaseOfInterest || '',
            location: data.medicalProfile.location || ''
          });
        }
      }).catch(err => console.error("Could not fetch profile:", err));
    }
  }, [user]);

  const handleSave = async () => {
    setLoading(true);
    try {
      await updateProfile(medicalProfile);
      setSaveStatus('Saved successfully!');
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (err) {
      setSaveStatus('Error saving profile');
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="page-container fade-in-section">
        <h2>Profile</h2>
        <p>Please log in to view and save your profile.</p>
      </div>
    );
  }

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
        <h2 className="page-title">Personal Profile</h2>
        
        <div className="settings-user-card">
          <img src={user.picture} alt="Profile" className="settings-avatar" referrerPolicy="no-referrer" />
          <div className="settings-user-info">
            <h3>{user.name}</h3>
            <p>{user.email}</p>
          </div>
        </div>

        <div className="settings-section form-card">
          <h4>Default Clinical Context</h4>
          <p className="settings-helper-text">
            These defaults automatically personalize your research without needing to type them into every new chat.
          </p>
          
          <div className="settings-form-group">
            <label>Patient Name (Optional)</label>
            <input 
              type="text" 
              value={medicalProfile.patientName}
              onChange={(e) => setMedicalProfile({...medicalProfile, patientName: e.target.value})}
              placeholder="e.g. John Doe, or self"
            />
          </div>
          <div className="settings-form-group">
            <label>Primary Condition / Disease</label>
            <input 
              type="text" 
              value={medicalProfile.diseaseOfInterest}
              onChange={(e) => setMedicalProfile({...medicalProfile, diseaseOfInterest: e.target.value})}
              placeholder="e.g. Advanced NSCLC, Cystic Fibrosis"
            />
          </div>
          <div className="settings-form-group">
            <label>Geographic Hub</label>
            <input 
              type="text" 
              value={medicalProfile.location}
              onChange={(e) => setMedicalProfile({...medicalProfile, location: e.target.value})}
              placeholder="e.g. New York, Toronto, UK"
            />
          </div>

          <div className="settings-actions">
            <button className="settings-save-btn" onClick={handleSave} disabled={loading}>
              {loading ? 'Saving...' : 'Save Context'}
            </button>
            {saveStatus && <span className="settings-save-status">{saveStatus}</span>}
          </div>
        </div>

        <div className="settings-section form-card">
          <h4>Appearance</h4>
          
          <div className="settings-form-group theme-toggle-group">
            <label>Interface Theme</label>
            <div className="theme-switch-wrapper" onClick={toggleTheme}>
              <div className={`theme-switch ${theme === 'dark' ? 'dark' : 'light'}`}>
                <div className="theme-switch-handle"></div>
                <span className="theme-switch-label light-label">Light</span>
                <span className="theme-switch-label dark-label">Dark</span>
              </div>
            </div>
            <p className="settings-helper-text" style={{marginTop: '12px'}}>
              Switch between Light and Dark aesthetic modes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
