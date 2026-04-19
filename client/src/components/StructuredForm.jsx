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
      label: 'Disease of Interest',
      placeholder: "e.g., Parkinson's disease",
      required: true,
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M8 5V11M5 8H11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: 'sf-query',
      field: 'query',
      label: 'Treatment / Query',
      placeholder: 'e.g., Deep Brain Stimulation',
      required: false,
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: 'sf-patient',
      field: 'patientName',
      label: 'Patient Name',
      placeholder: 'e.g., John Smith',
      required: false,
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M3 14C3 11.24 5.24 9 8 9C10.76 9 13 11.24 13 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: 'sf-location',
      field: 'location',
      label: 'Location',
      placeholder: 'e.g., Toronto, Canada',
      required: false,
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 1.5C5.24 1.5 3 3.74 3 6.5C3 10.25 8 14.5 8 14.5C8 14.5 13 10.25 13 6.5C13 3.74 10.76 1.5 8 1.5Z" stroke="currentColor" strokeWidth="1.3"/>
          <circle cx="8" cy="6.5" r="2" stroke="currentColor" strokeWidth="1.3"/>
        </svg>
      ),
    },
  ];

  const isValid = form.disease.trim().length > 0;

  return (
    <form className="structured-form" onSubmit={handleSubmit}>
      <div className="sf-header">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
          <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
          <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
          <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
        </svg>
        <span>Structured Research Query</span>
      </div>
      <div className="form-grid">
        {fields.map((f) => (
          <div key={f.id} className={`form-group-v2 ${focused === f.field ? 'focused' : ''} ${f.required ? 'required' : ''}`}>
            <label htmlFor={f.id}>
              {f.icon}
              {f.label}
              {f.required && <span className="required-star">*</span>}
            </label>
            <input
              id={f.id}
              type="text"
              placeholder={f.placeholder}
              value={form[f.field]}
              onChange={e => handleChange(f.field, e.target.value)}
              onFocus={() => setFocused(f.field)}
              onBlur={() => setFocused(null)}
              required={f.required}
            />
          </div>
        ))}
      </div>
      <div className="form-actions">
        <div className="form-hint">
          {isValid ? (
            <span className="hint-ready">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Ready to research
            </span>
          ) : (
            <span className="hint-required">Enter a disease to begin</span>
          )}
        </div>
        <button
          type="submit"
          className={`form-submit-btn ${isValid ? 'ready' : ''}`}
          disabled={disabled || !isValid}
          id="structured-submit-btn"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M6 8L8 6L10 8M8 6V11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Research Now
        </button>
      </div>
    </form>
  );
}
