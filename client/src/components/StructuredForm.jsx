import React, { useState } from 'react';

export default function StructuredForm({ onSubmit, disabled }) {
  const [form, setForm] = useState({
    patientName: '',
    disease: '',
    query: '',
    location: ''
  });

  const [focused, setFocused] = useState(null);

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.disease.trim()) return;
    onSubmit(form);
    setForm({ patientName: '', disease: '', query: '', location: '' });
  };

  const fields = [
    {
      id: 'sf-disease',
      field: 'disease',
      label: 'Disease / Condition',
      placeholder: "e.g., Parkinson's disease",
      required: true,
      desc: 'The primary medical condition to research',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"/>
          <path d="M12 7V15M8 11H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: 'sf-query',
      field: 'query',
      label: 'Specific Query (Optional)',
      placeholder: 'e.g., Deep Brain Stimulation',
      required: false,
      desc: 'Specific treatment, trial, or symptom',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2"/>
          <path d="M15 15L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: 'sf-patient',
      field: 'patientName',
      label: 'Patient Name (Optional)',
      placeholder: 'e.g., John Smith',
      required: false,
      desc: 'For personalized clinical reports',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M20 21C20 18.2386 16.4183 16 12 16C7.58172 16 4 18.2386 4 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          <circle cx="12" cy="9" r="4" stroke="currentColor" strokeWidth="2"/>
        </svg>
      ),
    },
    {
      id: 'sf-location',
      field: 'location',
      label: 'Geographic Location (Optional)',
      placeholder: 'e.g., Toronto, Canada',
      required: false,
      desc: 'To filter clinical trials by area',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M12 2C8.13401 2 5 5.13401 5 9C5 14.25 12 22 12 22C12 22 19 14.25 19 9C19 5.13401 15.866 2 12 2Z" stroke="currentColor" strokeWidth="2"/>
          <circle cx="12" cy="9" r="2.5" stroke="currentColor" strokeWidth="2"/>
        </svg>
      ),
    },
  ];

  const isValid = form.disease.trim().length > 0;

  return (
    <div className="structured-form-container">
      <div className="structured-form-glass">
        <form className="structured-form-premium" onSubmit={handleSubmit}>
          
          <div className="sf-premium-header">
            <div className="sf-header-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="2"/>
                <rect x="14" y="3" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="2"/>
                <rect x="3" y="14" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="2"/>
                <rect x="14" y="14" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="2"/>
              </svg>
            </div>
            <div className="sf-header-text">
              <h3>Precision Query Engine</h3>
              <p>Execute targeted research across PubMed, OpenAlex, and ClinicalTrials.gov</p>
            </div>
          </div>

          <div className="sf-premium-grid">
            {fields.map((f) => {
              const isActive = focused === f.field || form[f.field].length > 0;
              return (
                <div key={f.id} className={`sf-input-wrap ${isActive ? 'active' : ''} ${focused === f.field ? 'focused' : ''} ${f.required ? 'required' : ''}`}>
                  <div className="sf-input-icon">{f.icon}</div>
                  <div className="sf-input-content">
                    <label htmlFor={f.id}>
                      {f.label} {f.required && <span className="star">*</span>}
                    </label>
                    <input
                      id={f.id}
                      type="text"
                      placeholder={isActive ? f.placeholder : ''}
                      value={form[f.field]}
                      onChange={e => handleChange(f.field, e.target.value)}
                      onFocus={() => setFocused(f.field)}
                      onBlur={() => setFocused(null)}
                      required={f.required}
                    />
                    <span className="sf-input-desc">{f.desc}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="sf-premium-actions">
            <div className="sf-premium-hint">
              {isValid ? (
                <span className="hint-ready">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 13L9 17L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  System ready for execution
                </span>
              ) : (
                <span className="hint-required">A disease or condition is required</span>
              )}
            </div>
            
            <button
              type="submit"
              className={`sf-premium-submit ${isValid ? 'ready' : ''}`}
              disabled={disabled || !isValid}
            >
              <span className="sf-submit-text">Execute Research</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                <path d="M12 8L16 12M16 12L12 16M16 12H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
