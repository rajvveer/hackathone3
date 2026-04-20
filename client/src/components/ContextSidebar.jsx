import React, { useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
);

export default function ContextSidebar({ contextData, overview, stats, fullData }) {
  if (!contextData) return null;

  // Calculate advanced metrics
  let totalEnrollment = 0;
  if (fullData && fullData.clinicalTrials) {
    totalEnrollment = fullData.clinicalTrials.reduce((sum, trial) => sum + (Number(trial.enrollmentCount) || 0), 0);
  }

  const topResearcher = (fullData && fullData.researchers && fullData.researchers.length > 0) 
    ? fullData.researchers[0] 
    : null;

  const chartInfo = useMemo(() => {
    let chartData = null;
    if (fullData && fullData.publications && fullData.publications.length > 0) {
      const yearCounts = {};
      fullData.publications.forEach(pub => {
        if (pub.year && pub.year >= 2010 && pub.year <= new Date().getFullYear()) {
          yearCounts[pub.year] = (yearCounts[pub.year] || 0) + 1;
        }
      });
      const sortedYears = Object.keys(yearCounts).sort();
      if (sortedYears.length > 0) {
        chartData = {
          labels: sortedYears,
          datasets: [
            {
              label: 'Publications',
              data: sortedYears.map(y => yearCounts[y]),
              backgroundColor: 'rgba(52, 211, 153, 0.4)',
              borderColor: 'rgba(52, 211, 153, 1)',
              borderWidth: 1,
              borderRadius: 4,
            }
          ]
        };
      }
    }
    const chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: false },
        tooltip: {
          backgroundColor: '#1E293B',
          titleColor: '#F8FAFC',
          bodyColor: '#CBD5E1',
          titleFont: { size: 13, family: 'Inter, sans-serif', weight: 'bold' },
          bodyFont: { size: 12, family: 'Inter, sans-serif' },
          padding: 10,
          cornerRadius: 6,
          displayColors: false,
          callbacks: {
            label: function(context) {
              return `${context.parsed.y} Publications`;
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#94A3B8', font: { size: 10, family: 'Inter' } } },
        y: { display: false }
      }
    };
    return { data: chartData, options: chartOptions };
  }, [fullData]);

  return (
    <aside className="context-sidebar fade-in-section">
      <div className="context-sidebar-inner">
        <div className="cs-header">
          <div className="cs-icon">🏥</div>
          <div className="cs-title-wrap">
            <h3 className="cs-title">Clinical Context</h3>
            <span className="cs-status">Active Session</span>
          </div>
        </div>

        <div className="cs-section cs-profile-card">
          <div className="cs-profile-row">
            <span className="cs-label">Patient</span>
            <span className="cs-value">{contextData.patientName || 'Anonymous'}</span>
          </div>
          <div className="cs-profile-row">
            <span className="cs-label">Condition</span>
            <span className="cs-value highlight">{contextData.disease}</span>
          </div>
          {contextData.query && (
            <div className="cs-profile-row">
              <span className="cs-label">Specific Focus</span>
              <span className="cs-value">{contextData.query}</span>
            </div>
          )}
          {contextData.location && (
             <div className="cs-profile-row">
             <span className="cs-label">Location</span>
             <span className="cs-value">{contextData.location}</span>
           </div>
          )}
        </div>

        {overview && (
          <div className="cs-section glass-panel">
            <h4 className="cs-section-title">
              <span className="cs-section-icon">🧠</span> AI Overview
            </h4>
            <p className="cs-overview-text">{overview}</p>
          </div>
        )}

        {stats && (
          <div className="cs-section cs-stats-grid">
            <div className="cs-stat-box">
              <span className="cs-stat-value">{stats.pubmed + stats.openAlex}</span>
              <span className="cs-stat-label">Publications</span>
            </div>
            <div className="cs-stat-box">
              <span className="cs-stat-value">{stats.trials}</span>
              <span className="cs-stat-label">Clinical Trials</span>
            </div>
            <div className="cs-stat-box full-width" style={{ gridColumn: '1 / -1' }}>
              <span className="cs-stat-value">{totalEnrollment.toLocaleString()}</span>
              <span className="cs-stat-label">Target Patient Enrollment</span>
            </div>
          </div>
        )}

        {chartInfo.data && (
          <div className="cs-section glass-panel" style={{ padding: '16px' }}>
            <h4 className="cs-section-title" style={{ marginBottom: '16px' }}>
              <span className="cs-section-icon">📈</span> Research Momentum
            </h4>
            <div style={{ height: '120px', width: '100%' }}>
              <Bar data={chartInfo.data} options={chartInfo.options} />
            </div>
          </div>
        )}

        {topResearcher && (
          <div className="cs-section cs-researcher-highlight">
            <h4 className="cs-section-title">🏆 Leading Expert</h4>
            <div className="cs-researcher-card">
              <div className="cs-researcher-name">{topResearcher.name}</div>
              <div className="cs-researcher-inst">{topResearcher.institution}</div>
              {topResearcher.citationCount && (
                <div className="cs-researcher-metric">
                  <span className="cs-metric-chip">🔥 {topResearcher.citationCount.toLocaleString()} Citations</span>
                  <span className="cs-metric-chip">h-index: {topResearcher.hIndex}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
