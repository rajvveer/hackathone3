import React, { useState, useEffect, useRef } from 'react';
import { GoogleLogin } from '@react-oauth/google';

export default function Sidebar({ conversations, currentConversationId, onSelectConversation, onNewChat, onDeleteConversation, isOpen, onClose, user, loginUser, logoutUser, onChangeView }) {
  const [hoveredId, setHoveredId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileMenuRef = useRef(null);

  // Close menu if clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setShowProfileMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  // Group conversations by time period
  const groupConversations = (convs) => {
    const now = new Date();
    const today = [];
    const yesterday = [];
    const thisWeek = [];
    const older = [];

    convs.forEach(conv => {
      const d = new Date(conv.updatedAt);
      const diffMs = now - d;
      const diffHrs = diffMs / (1000 * 60 * 60);

      if (diffHrs < 24) today.push(conv);
      else if (diffHrs < 48) yesterday.push(conv);
      else if (diffHrs < 168) thisWeek.push(conv);
      else older.push(conv);
    });

    const groups = [];
    if (today.length) groups.push({ label: 'Today', items: today });
    if (yesterday.length) groups.push({ label: 'Yesterday', items: yesterday });
    if (thisWeek.length) groups.push({ label: 'This Week', items: thisWeek });
    if (older.length) groups.push({ label: 'Older', items: older });
    return groups;
  };

  const groups = groupConversations(conversations);

  const handleDelete = (e, convId) => {
    e.stopPropagation();
    if (confirmDeleteId === convId) {
      onDeleteConversation(convId);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(convId);
      // Auto-reset after 3s
      setTimeout(() => setConfirmDeleteId(null), 3000);
    }
  };

  return (
    <>
      <div className={`sidebar-backdrop ${isOpen ? 'visible' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        {/* Logo */}
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="logo-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="currentColor" />
              </svg>
            </div>
            <div>
              <h1>Curalink</h1>
              <span className="logo-subtitle">AI Research Assistant</span>
            </div>
          </div>
          <button className="new-chat-btn" onClick={onNewChat} id="new-chat-btn">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            New Research Chat
          </button>
        </div>

        {/* Conversation list */}
        <div className="sidebar-conversations">
          {conversations.length === 0 && (
            <div className="sidebar-empty">
              <div className="sidebar-empty-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <path d="M21 15C21 15.53 20.79 16.04 20.41 16.41C20.04 16.79 19.53 17 19 17H7L3 21V5C3 4.47 3.21 3.96 3.59 3.59C3.96 3.21 4.47 3 5 3H19C19.53 3 20.04 3.21 20.41 3.59C20.79 3.96 21 4.47 21 5V15Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="sidebar-empty-text">No conversations yet</p>
              <p className="sidebar-empty-hint">Start a new research chat to explore medical literature</p>
            </div>
          )}

          {groups.map((group, gi) => (
            <div key={gi} className="conv-group">
              <div className="conv-group-label">{group.label}</div>
              {group.items.map(conv => {
                const isActive = conv.conversationId === currentConversationId;
                const isHovered = hoveredId === conv.conversationId;
                const isConfirmDelete = confirmDeleteId === conv.conversationId;

                return (
                  <div
                    key={conv.conversationId}
                    className={`conv-item ${isActive ? 'active' : ''}`}
                    onClick={() => onSelectConversation(conv.conversationId)}
                    onMouseEnter={() => setHoveredId(conv.conversationId)}
                    onMouseLeave={() => { setHoveredId(null); setConfirmDeleteId(null); }}
                    id={`conv-${conv.conversationId}`}
                  >
                    <div className="conv-icon">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <path d="M14 10C14 10.35 13.86 10.69 13.61 10.94C13.36 11.19 13.02 11.33 12.67 11.33H5.33L2 14.67V3.33C2 2.98 2.14 2.64 2.39 2.39C2.64 2.14 2.98 2 3.33 2H12.67C13.02 2 13.36 2.14 13.61 2.39C13.86 2.64 14 2.98 14 3.33V10Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div className="conv-content">
                      <span className="conv-title">{conv.title || 'Untitled'}</span>
                      <span className="conv-date">{formatDate(conv.updatedAt)}</span>
                    </div>
                    <button
                      className={`conv-delete-btn ${isConfirmDelete ? 'confirm' : ''}`}
                      onClick={(e) => handleDelete(e, conv.conversationId)}
                      title={isConfirmDelete ? 'Click again to confirm' : 'Delete'}
                    >
                      {isConfirmDelete ? (
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                          <path d="M4 8.5L6.5 11L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                          <path d="M2.5 4.5H13.5M5.5 4.5V3C5.5 2.45 5.95 2 6.5 2H9.5C10.05 2 10.5 2.45 10.5 3V4.5M12.5 4.5V13C12.5 13.55 12.05 14 11.5 14H4.5C3.95 14 3.5 13.55 3.5 13V4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="sidebar-footer">
          {user ? (
            <div className="user-profile-container" ref={profileMenuRef}>
              <div 
                className={`user-profile clickable ${showProfileMenu ? 'active' : ''}`} 
                onClick={() => setShowProfileMenu(!showProfileMenu)}
              >
                <img src={user.picture} alt="Profile" className="user-avatar" referrerPolicy="no-referrer" />
                <div className="user-info">
                  <span className="user-name">{user.name}</span>
                  <span className="user-email">{user.email}</span>
                </div>
                <svg className="profile-menu-arrow" width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M4 10L8 6L12 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>

              {showProfileMenu && (
                <div className="profile-dropdown-menu">
                  <button 
                    className="dropdown-item" 
                    onClick={() => { onChangeView('profile'); setShowProfileMenu(false); onClose && onClose(); }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M4 20C4 16.6863 7.58172 14 12 14C16.4183 14 20 16.6863 20 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Profile & Settings
                  </button>
                  <div className="dropdown-divider"></div>
                  <button 
                    className="dropdown-item text-danger" 
                    onClick={() => { logoutUser(); setShowProfileMenu(false); }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M9 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M16 17L21 12L16 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M21 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Log Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="auth-section">
              <GoogleLogin
                onSuccess={(res) => loginUser(res.credential)}
                onError={() => console.error('Google Login Failed')}
                theme="filled_black"
                shape="rectangular"
                text="signin_with"
                size="large"
              />
              <p className="auth-hint">Login to save your conversations permanently.</p>
            </div>
          )}
          <div className="sidebar-footer-badge" style={{ marginTop: '12px' }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M8 5V8.5L10 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <span>Powered by Llama 3 70B</span>
          </div>
        </div>
      </aside>
    </>
  );
}
