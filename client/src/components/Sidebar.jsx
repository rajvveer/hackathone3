import React from 'react';

export default function Sidebar({ conversations, currentConversationId, onSelectConversation, onNewChat, onDeleteConversation, isOpen, onClose }) {
  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  };

  return (
    <>
      <div className={`sidebar-backdrop ${isOpen ? 'visible' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="logo-icon">✦</div>
            <div>
              <h1>Curalink</h1>
            </div>
          </div>
          <button className="new-chat-btn" onClick={onNewChat} id="new-chat-btn">
            <span>＋</span> New Research Chat
          </button>
        </div>

        <div className="sidebar-conversations">
          {conversations.length === 0 && (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 20 }}>
              No conversations yet.<br />Start a new research chat!
            </p>
          )}
          {conversations.map(conv => (
            <div
              key={conv.conversationId}
              className={`conv-item ${conv.conversationId === currentConversationId ? 'active' : ''}`}
              onClick={() => onSelectConversation(conv.conversationId)}
              id={`conv-${conv.conversationId}`}
            >
              <span className="conv-title">
                {conv.title || 'Untitled'}
              </span>
              <span className="conv-date">{formatDate(conv.updatedAt)}</span>
              <button
                className="delete-btn"
                onClick={(e) => { e.stopPropagation(); onDeleteConversation(conv.conversationId); }}
                title="Delete"
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
