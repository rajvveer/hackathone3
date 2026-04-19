import React, { useState, useEffect, useRef } from 'react';
import { useChat } from './hooks/useChat';
import Sidebar from './components/Sidebar';
import MessageBubble from './components/MessageBubble';
import LoadingState from './components/LoadingState';
import StructuredForm from './components/StructuredForm';
import FollowUpQuestions from './components/FollowUpQuestions';
import VoiceAssistant from './components/VoiceAssistant';
import FileUpload from './components/FileUpload';
import ContextSidebar from './components/ContextSidebar';
import ProfilePage from './components/ProfilePage';
import './index.css';
const QUICK_ACTIONS = [
  { icon: '🫁', label: 'Lung Cancer', text: 'Latest treatment for lung cancer' },
  { icon: '💉', label: 'Diabetes', text: 'Clinical trials for diabetes' },
  { icon: '🧠', label: "Alzheimer's", text: "Top researchers in Alzheimer's disease" },
  { icon: '❤️', label: 'Heart Disease', text: 'Recent studies on heart disease' },
  { icon: '🧬', label: 'Gene Therapy', text: 'Latest gene therapy breakthroughs' },
  { icon: '🦠', label: 'Immunotherapy', text: 'Cancer immunotherapy clinical trials' },
];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function App() {
  const {
    messages, conversations, currentConversationId,
    loading, loadingStep, stepMessage, expandedQueries, retrievalStats,
    messagesEndRef, send, uploadFile, startNewChat, loadConversation, removeConversation,
    user, loginUser, logoutUser,
    followUp, submitFollowUpAnswer, goBackFollowUp, skipFollowUp
  } = useChat();

  const [inputMode, setInputMode] = useState('chat');
  const [inputValue, setInputValue] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const textareaRef = useRef(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [currentView, setCurrentView] = useState('chat'); // 'chat', 'profile'

  // Theme: dark / light
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('curalink-theme') || 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('curalink-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [inputValue]);

  const handleSend = () => {
    const trimmed = inputValue.trim();
    if (!trimmed || loading) return;
    send(trimmed, false);
    setInputValue('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStructuredSubmit = (formData) => {
    if (loading) return;
    send(formData, true);
    setInputMode('chat');
  };

  const handleQuickAction = (text) => {
    if (loading) return;
    send(text, false);
  };

  // Determine if we need the Context Sidebar
  const activeContextMsg = messages.find(m => m.structuredInput);
  const activeResponseMsg = messages.find(m => m.response?.conditionOverview);
  
  const showRightSidebar = !!activeContextMsg;
  const contextData = activeContextMsg?.structuredInput;
  const contextOverview = activeResponseMsg?.response?.conditionOverview;
  
  // Try to find the latest valid retrieval stats out of the messages, or use live stats
  const contextStats = retrievalStats || (activeResponseMsg?.pipelineMetrics ? { 
    pubmed: activeResponseMsg.response.publications?.length || 0,
    openAlex: 0,
    trials: activeResponseMsg.response.clinicalTrials?.length || 0
  } : null);

  return (
    <div className={`app-layout ${showRightSidebar ? 'has-right-sidebar' : ''}`}>
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        user={user}
        loginUser={loginUser}
        logoutUser={logoutUser}
        onChangeView={(view) => setCurrentView(view)}
        onSelectConversation={(id) => {
          loadConversation(id);
          setCurrentView('chat');
          setSidebarOpen(false);
        }}
        onNewChat={() => {
          startNewChat();
          setCurrentView('chat');
          setSidebarOpen(false);
        }}
        onDeleteConversation={removeConversation}
      />

      <main className="main-area">
        {/* Header */}
        <header className="main-header">
          <div className="header-left">
            <button className="sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle sidebar">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M3 7H21M3 12H21M3 17H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
            <div className="header-brand">
              <h2>Curalink</h2>
              {messages.length > 0 && (
                <span className="header-subtitle">
                  {messages.filter(m => m.role === 'user').length} {messages.filter(m => m.role === 'user').length === 1 ? 'query' : 'queries'} this session
                </span>
              )}
            </div>
          </div>
          <div className="header-actions">
            <div className="mode-toggle">
              <button
                className={inputMode === 'chat' ? 'active' : ''}
                onClick={() => setInputMode('chat')}
                id="mode-chat"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M14 10C14 10.35 13.86 10.69 13.61 10.94C13.36 11.19 13.02 11.33 12.67 11.33H5.33L2 14.67V3.33C2 2.98 2.14 2.64 2.39 2.39C2.64 2.14 2.98 2 3.33 2H12.67C13.02 2 13.36 2.14 13.61 2.39C13.86 2.64 14 2.98 14 3.33V10Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Chat
              </button>
              <button
                className={inputMode === 'structured' ? 'active' : ''}
                onClick={() => setInputMode('structured')}
                id="mode-structured"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                  <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                  <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                  <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                </svg>
                Structured
              </button>
            </div>
          </div>
        </header>

        {/* Sub-Header area with dynamic content */}
        {currentView === 'chat' && loading && expandedQueries.length > 0 && (
          <div className="pipeline-banner">
            <div className="pipeline-banner-inner">
              <div className="pipeline-banner-left">
                <div className="pipeline-pulse" />
                <span className="pipeline-banner-label">Searching</span>
              </div>
              <div className="pipeline-queries">
                {expandedQueries.map((q, i) => (
                  <span key={i} className="pipeline-query-tag">{q}</span>
                ))}
              </div>
              {retrievalStats && (
                <div className="pipeline-live-stats">
                  <span className="pipeline-stat">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 13V7H5V13M6.5 13V3H9.5V13M11 13V9H14V13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    {retrievalStats.openAlex + retrievalStats.pubmed} pubs
                  </span>
                  <span className="pipeline-stat">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="6" r="4" stroke="currentColor" strokeWidth="1.2"/><path d="M4 14C4 11.79 5.79 10 8 10C10.21 10 12 11.79 12 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                    {retrievalStats.trials} trials
                  </span>
                  {retrievalStats.fromCache && (
                    <span className="pipeline-stat cache">⚡ {retrievalStats.fromCache}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {currentView === 'chat' && (<>
        {/* Messages */}
        <div className="messages-container">
          {messages.length === 0 && !loading && (
            <div className="welcome-screen">
              <div className="welcome-hero">
                <div className="welcome-icon-wrapper">
                  <div className="welcome-icon-bg" />
                  <div className="welcome-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                      <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="currentColor"/>
                    </svg>
                  </div>
                </div>
                <h2>{getGreeting()}</h2>
                <p className="welcome-subtitle">
                  What medical research would you like to explore today?
                </p>
              </div>
              <div className="quick-actions">
                {QUICK_ACTIONS.map((action, i) => (
                  <button
                    key={i}
                    className="quick-action"
                    onClick={() => handleQuickAction(action.text)}
                    id={`quick-action-${i}`}
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <span className="qa-icon">{action.icon}</span>
                    <div className="qa-content">
                      <span className="qa-label">{action.label}</span>
                      <span className="qa-text">{action.text}</span>
                    </div>
                    <svg className="qa-arrow" width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                ))}
              </div>
              <div className="welcome-footer">
                <span>Powered by</span>
                <span className="welcome-badge">PubMed</span>
                <span className="welcome-badge">OpenAlex</span>
                <span className="welcome-badge">ClinicalTrials.gov</span>
                <span className="welcome-badge">Llama 3 70B</span>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble key={i} message={msg} conversationId={currentConversationId} />
          ))}

          {/* Follow-up clarification questions */}
          {followUp && (
            <FollowUpQuestions
              followUp={followUp}
              onAnswer={submitFollowUpAnswer}
              onGoBack={goBackFollowUp}
              onSkip={skipFollowUp}
              disabled={loading}
            />
          )}

          {loading && <LoadingState step={loadingStep} stepMessage={stepMessage} />}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="input-area">
          {inputMode === 'chat' ? (
            <div className={`input-wrapper ${loading ? 'disabled' : ''}`}>
              <div className="input-field-wrapper">
                <svg className="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/>
                  <path d="M16 16L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <textarea
                  ref={textareaRef}
                  className="chat-input"
                  placeholder="Ask about any disease, treatment, or clinical trial..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loading}
                  rows={1}
                  id="chat-input"
                />
              </div>
              <div className="input-actions">
                <span className="input-hint">Enter ↵</span>
                <button
                  className="file-upload-toggle-btn"
                  onClick={() => setShowFileUpload(true)}
                  title="Upload Medical Document"
                  id="file-upload-btn"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M21.44 11.05L12.25 20.24C11.12 21.37 9.58 22 7.97 22C6.36 22 4.82 21.37 3.69 20.24C2.56 19.11 1.93 17.57 1.93 15.96C1.93 14.35 2.56 12.81 3.69 11.68L12.88 2.49C13.64 1.73 14.67 1.3 15.74 1.3C16.82 1.3 17.85 1.73 18.6 2.49C19.36 3.25 19.79 4.28 19.79 5.35C19.79 6.43 19.36 7.46 18.6 8.22L9.41 17.41C9.03 17.79 8.51 18 7.97 18C7.43 18 6.91 17.79 6.53 17.41C6.15 17.03 5.94 16.51 5.94 15.97C5.94 15.43 6.15 14.91 6.53 14.53L15.07 5.99" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                <button
                  className="voice-toggle-btn"
                  onClick={() => setVoiceMode(true)}
                  title="Voice Mode"
                  id="voice-mode-btn"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M12 4V20M8 9V15M4 11V13M16 7V17M20 10V14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                <button
                  className={`send-btn ${inputValue.trim() ? 'active' : ''}`}
                  onClick={handleSend}
                  disabled={loading || !inputValue.trim()}
                  id="send-btn"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M8 12V4M8 4L4 8M8 4L12 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            </div>
          ) : (
             <StructuredForm onSubmit={handleStructuredSubmit} disabled={loading} />
          )}
        </div>
      </>)}
      
      {currentView === 'profile' && (
        <ProfilePage user={user} theme={theme} toggleTheme={toggleTheme} onBack={() => setCurrentView('chat')} />
      )}
      </main>

      {/* Right Context Sidebar */}
      {showRightSidebar && currentView === 'chat' && (
        <ContextSidebar 
          contextData={contextData} 
          overview={contextOverview} 
          stats={contextStats} 
          fullData={activeResponseMsg?.response}
        />
      )}

      {/* Voice Mode Modal */}
      {voiceMode && (
        <VoiceAssistant
          onClose={() => setVoiceMode(false)}
          onResearchData={(data) => console.log('Voice research data:', data)}
        />
      )}

      {/* File Upload Modal */}
      {showFileUpload && (
        <FileUpload
          onUpload={(file, query) => uploadFile(file, query)}
          onClose={() => setShowFileUpload(false)}
          disabled={loading}
        />
      )}
    </div>
  );
}
