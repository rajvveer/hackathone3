import React, { useState } from 'react';
import { useChat } from './hooks/useChat';
import Sidebar from './components/Sidebar';
import MessageBubble from './components/MessageBubble';
import LoadingState from './components/LoadingState';
import StructuredForm from './components/StructuredForm';
import './index.css';

const QUICK_ACTIONS = [
  { icon: '🫁', text: 'Latest treatment for lung cancer' },
  { icon: '💉', text: 'Clinical trials for diabetes' },
  { icon: '🧠', text: 'Top researchers in Alzheimer\'s disease' },
  { icon: '❤️', text: 'Recent studies on heart disease' },
];

export default function App() {
  const {
    messages, conversations, currentConversationId,
    loading, loadingStep, stepMessage, expandedQueries, retrievalStats,
    messagesEndRef, send, startNewChat, loadConversation, removeConversation
  } = useChat();

  const [inputMode, setInputMode] = useState('chat');
  const [inputValue, setInputValue] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
  };

  const handleQuickAction = (text) => {
    if (loading) return;
    send(text, false);
  };

  return (
    <div className="app-layout">
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={(id) => { loadConversation(id); setSidebarOpen(false); }}
        onNewChat={() => { startNewChat(); setSidebarOpen(false); }}
        onDeleteConversation={removeConversation}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="main-area">
        {/* Header */}
        <header className="main-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
            <h2 style={{ fontSize: 16 }}>Curalink</h2>
          </div>
          <div className="header-actions">
            <div className="mode-toggle">
              <button
                className={inputMode === 'chat' ? 'active' : ''}
                onClick={() => setInputMode('chat')}
                id="mode-chat"
              >
                💬 Chat
              </button>
              <button
                className={inputMode === 'structured' ? 'active' : ''}
                onClick={() => setInputMode('structured')}
                id="mode-structured"
              >
                📋 Structured
              </button>
            </div>
          </div>
        </header>

        {/* Live pipeline info banner — shows during loading */}
        {loading && expandedQueries.length > 0 && (
          <div className="pipeline-banner">
            <span className="pipeline-banner-label">🔍 Searching:</span>
            <div className="pipeline-queries">
              {expandedQueries.map((q, i) => (
                <span key={i} className="pipeline-query-tag">{q}</span>
              ))}
            </div>
            {retrievalStats && (
              <div className="pipeline-live-stats">
                <span>📚 {retrievalStats.openAlex + retrievalStats.pubmed} pubs</span>
                <span>🧪 {retrievalStats.trials} trials</span>
                {retrievalStats.fromCache && <span>⚡ {retrievalStats.fromCache} cache</span>}
              </div>
            )}
          </div>
        )}

        {/* Messages */}
        <div className="messages-container">
          {messages.length === 0 && !loading && (
            <div className="welcome-screen">
              <div className="welcome-icon">✨</div>
              <h2>Good afternoon</h2>
              <div className="quick-actions">
                {QUICK_ACTIONS.map((action, i) => (
                  <div
                    key={i}
                    className="quick-action"
                    onClick={() => handleQuickAction(action.text)}
                    id={`quick-action-${i}`}
                  >
                    <div className="qa-text">{action.text}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble key={i} message={msg} />
          ))}

          {loading && <LoadingState step={loadingStep} stepMessage={stepMessage} />}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="input-area">
          {inputMode === 'chat' ? (
            <div className="input-wrapper">
              <div className="input-field-wrapper">
                <textarea
                  className="chat-input"
                  placeholder="How can Curalink help you today?"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loading}
                  rows={1}
                  id="chat-input"
                />
              </div>
              <div className="input-actions">
                <button
                  className={`send-btn ${inputValue.trim() ? 'active' : ''}`}
                  onClick={handleSend}
                  disabled={loading || !inputValue.trim()}
                  id="send-btn"
                >
                  ↑
                </button>
              </div>
            </div>
          ) : (
            <StructuredForm onSubmit={handleStructuredSubmit} disabled={loading} />
          )}
        </div>
      </main>
    </div>
  );
}
