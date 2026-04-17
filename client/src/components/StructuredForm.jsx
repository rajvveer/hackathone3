import React, { useState } from 'react';

export default function StructuredForm({ onSubmit, disabled }) {
  const [form, setForm] = useState({
    patientName: '',
    disease: '',
    query: '',
    location: ''
  });

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.disease.trim()) return;
    onSubmit(form);
    setForm({ patientName: '', disease: '', query: '', location: '' });
  };

  return (
    <form className="structured-form" onSubmit={handleSubmit}>
      <div className="form-grid">
        <div className="form-group">
          <label htmlFor="sf-patient">Patient Name (Optional)</label>
          <input
            id="sf-patient"
            type="text"
            placeholder="e.g., John Smith"
            value={form.patientName}
            onChange={e => handleChange('patientName', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="sf-location">Location (Optional)</label>
          <input
            id="sf-location"
            type="text"
            placeholder="e.g., Toronto, Canada"
            value={form.location}
            onChange={e => handleChange('location', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="sf-disease">Disease of Interest *</label>
          <input
            id="sf-disease"
            type="text"
            placeholder="e.g., Parkinson's disease"
            value={form.disease}
            onChange={e => handleChange('disease', e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="sf-query">Treatment / Query</label>
          <input
            id="sf-query"
            type="text"
            placeholder="e.g., Deep Brain Stimulation"
            value={form.query}
            onChange={e => handleChange('query', e.target.value)}
          />
        </div>
      </div>
      <div className="form-actions">
        <button type="submit" className="form-submit-btn" disabled={disabled || !form.disease.trim()} id="structured-submit-btn">
          🔬 Research Now
        </button>
      </div>
    </form>
  );
}
