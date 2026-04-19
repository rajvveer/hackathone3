import React, { useState, useEffect } from 'react';

/**
 * Claude-style interactive follow-up questions component.
 * Shows one question at a time with numbered clickable option cards.
 */
export default function FollowUpQuestions({
  followUp,
  onAnswer,
  onGoBack,
  onSkip,
  disabled
}) {
  const [customText, setCustomText] = useState('');
  const [animating, setAnimating] = useState(false);
  const [direction, setDirection] = useState('forward'); // 'forward' | 'back'

  const { questions, currentIndex, answers, originalQuery } = followUp;
  const currentQuestion = questions[currentIndex];
  const totalQuestions = questions.length;
  const isFirstQuestion = currentIndex === 0;

  // Reset custom text when question changes
  useEffect(() => {
    setCustomText('');
    // Trigger slide animation
    setAnimating(true);
    const t = setTimeout(() => setAnimating(false), 350);
    return () => clearTimeout(t);
  }, [currentIndex]);

  const handleOptionClick = (option) => {
    if (disabled || animating) return;
    setDirection('forward');
    onAnswer(option);
  };

  const handleCustomSubmit = () => {
    const trimmed = customText.trim();
    if (!trimmed || disabled || animating) return;
    setDirection('forward');
    onAnswer(trimmed);
  };

  const handleGoBack = () => {
    if (isFirstQuestion || disabled || animating) return;
    setDirection('back');
    onGoBack();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleCustomSubmit();
    }
  };

  return (
    <div className="followup-container">
      <div className="followup-card">
        {/* Header */}
        <div className="followup-header">
          <div className="followup-header-left">
            <div className="followup-avatar">✦</div>
            <span className="followup-intro">
              {currentIndex === 0
                ? 'To give you the best research insights, a few quick questions:'
                : 'Great! Next question:'}
            </span>
          </div>
          <div className="followup-header-right">
            <span className="followup-progress">{currentIndex + 1} of {totalQuestions}</span>
            <button
              className="followup-skip-btn"
              onClick={onSkip}
              title="Skip questions and research now"
            >
              Skip
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="followup-progress-track">
          <div
            className="followup-progress-fill"
            style={{ width: `${((currentIndex) / totalQuestions) * 100}%` }}
          />
        </div>

        {/* Question */}
        <div
          className={`followup-question-wrapper ${animating ? `slide-${direction}` : ''}`}
          key={currentIndex}
        >
          <h3 className="followup-question">{currentQuestion.question}</h3>

          {/* Options */}
          <div className="followup-options">
            {currentQuestion.options.map((option, i) => (
              <button
                key={i}
                className="followup-option"
                onClick={() => handleOptionClick(option)}
                disabled={disabled}
                id={`followup-option-${i}`}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <span className="followup-option-number">{i + 1}</span>
                <span className="followup-option-text">{option}</span>
                <svg className="followup-option-arrow" width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ))}

            {/* Something else - free text */}
            <div className="followup-custom">
              <span className="followup-custom-icon">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M11.5 2.5L13.5 4.5M1.5 14.5L2.2 11.7L12 2L14 4L4.3 13.8L1.5 14.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <input
                type="text"
                className="followup-custom-input"
                placeholder="Something else..."
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={disabled}
                id="followup-custom-input"
              />
              {customText.trim() && (
                <button
                  className="followup-custom-submit"
                  onClick={handleCustomSubmit}
                  disabled={disabled}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M8 12V4M8 4L4 8M8 4L12 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Footer with back button + answered pills */}
        <div className="followup-footer">
          <div className="followup-footer-left">
            {!isFirstQuestion && (
              <button
                className="followup-back-btn"
                onClick={handleGoBack}
                disabled={disabled}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M10 4L6 8L10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Back
              </button>
            )}
          </div>
          <div className="followup-answered-pills">
            {answers.map((answer, i) => (
              <span key={i} className="followup-answered-pill" title={`${questions[i].question}: ${answer}`}>
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8.5L6.5 11L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {answer.length > 20 ? answer.substring(0, 20) + '…' : answer}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
