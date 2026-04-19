const fs = require('fs');
let css = fs.readFileSync('index.css', 'utf-8');

// 1. Root & Dark Mode Variables
css = css.replace(
`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@400;500;600;700&display=swap');

:root {
  /* Core Colors - Sarvam Theme (Light) */
  --bg-primary: #F9F9F9;
  --bg-secondary: #FFFFFF;
  --bg-tertiary: #F1F1F1;
  --bg-card: #FFFFFF;
  --bg-user-bubble: #F1F1F1;
  
  /* Accent Colors */
  --accent-primary: #111111;
  --accent-secondary: #444444;
  --accent-gradient: #111111;
  --accent-glow: none;

  /* Status Colors */
  --status-recruiting: #10b981;
  --status-active: #3b82f6;
  --status-completed: #6b7280;
  --status-warning: #f59e0b;

  /* Text Colors */
  --text-primary: #111111;
  --text-secondary: #3A3A3A;
  --text-muted: #737373;
  --text-accent: #111111;

  /* Borders */
  --border-subtle: #E5E5E5;
  --border-accent: #111111;

  /* Spacing & Sizes */
  --sidebar-width: 260px;
  --header-height: 72px;
  --chat-max-width: 840px;

  /* Fonts */
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --font-serif: 'Space Grotesk', sans-serif;`,
`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Lora:ital,wght@0,400;0,500;1,400&display=swap');

:root {
  /* Core Colors - Claude Beige Theme (Light) */
  --bg-primary: #FAF8F5;
  --bg-secondary: #F2EFE9;
  --bg-tertiary: #EBE7E0;
  --bg-card: #FFFFFF;
  --bg-user-bubble: #EBE7E0;
  
  /* Accent Colors */
  --accent-primary: #D97757;
  --accent-secondary: #5C5248;
  --accent-gradient: #D97757;
  --accent-glow: none;

  /* Status Colors */
  --status-recruiting: #2E7D32;
  --status-active: #1565C0;
  --status-completed: #616161;
  --status-warning: #E65100;

  /* Text Colors */
  --text-primary: #2D2B2A;
  --text-secondary: #58534E;
  --text-muted: #8A8379;
  --text-accent: #D97757;

  /* Borders */
  --border-subtle: #E0DBD3;
  --border-accent: #D97757;

  /* Spacing & Sizes */
  --sidebar-width: 220px;
  --header-height: 56px;
  --chat-max-width: 768px;

  /* Fonts */
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --font-serif: 'Lora', 'Georgia', 'Charter', serif;`
);

css = css.replace(
`/* ========== DARK MODE ========== */
[data-theme="dark"] {
  --bg-primary: #050505;
  --bg-secondary: #111111;
  --bg-tertiary: #1A1A1A;
  --bg-card: #111111;
  --bg-user-bubble: #1F1F1F;

  --accent-primary: #FFFFFF;
  --accent-secondary: #CCCCCC;
  --accent-gradient: #FFFFFF;

  --status-recruiting: #10b981;
  --status-active: #3b82f6;
  --status-completed: #6b7280;
  --status-warning: #f59e0b;

  --text-primary: #FFFFFF;
  --text-secondary: #E5E5E5;
  --text-muted: #A3A3A3;
  --text-accent: #FFFFFF;

  --border-subtle: #262626;
  --border-accent: #FFFFFF;`,
`/* ========== DARK MODE ========== */
[data-theme="dark"] {
  --bg-primary: #1A1A1A;
  --bg-secondary: #222222;
  --bg-tertiary: #2A2A2A;
  --bg-card: #252525;
  --bg-user-bubble: #2E2E2E;

  --accent-primary: #E08A6D;
  --accent-secondary: #A09080;
  --accent-gradient: #E08A6D;

  --status-recruiting: #4CAF50;
  --status-active: #42A5F5;
  --status-completed: #9E9E9E;
  --status-warning: #FF7043;

  --text-primary: #E8E4DF;
  --text-secondary: #B0AAA2;
  --text-muted: #7A756E;
  --text-accent: #E08A6D;

  --border-subtle: #363636;
  --border-accent: #E08A6D;`
);

css = css.replace(
`.sidebar {
  width: var(--sidebar-width);
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: 24px;
  margin: 16px 0 16px 16px;
  height: calc(100vh - 32px);
  box-shadow: 0 4px 20px rgba(0,0,0,0.02);
  display: flex;
  flex-direction: column;
  transition: transform var(--transition-normal);
  z-index: 100;
}`,
`.sidebar {
  width: var(--sidebar-width);
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  transition: transform var(--transition-normal);
  z-index: 100;
}`
);

css = css.replace(
`.new-chat-btn {
  width: 100%;
  padding: 12px 14px;
  background: var(--text-primary);
  border: none;
  border-radius: 12px;
  color: var(--bg-primary);
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-shadow: inset 0 2px 8px rgba(255,255,255,0.15), 0 4px 12px rgba(0,0,0,0.08);
}

.new-chat-btn:hover {
  background: var(--accent-secondary);
  transform: translateY(-2px);
  box-shadow: inset 0 2px 12px rgba(255,255,255,0.25), 0 6px 16px rgba(0,0,0,0.12);
}`,
`.new-chat-btn {
  width: 100%;
  padding: 9px 12px;
  background: var(--text-primary);
  border: none;
  border-radius: 8px;
  color: var(--bg-primary);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.new-chat-btn:hover {
  background: var(--accent-primary);
  color: #fff;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(217,119,87,0.25);
}`
);

css = css.replace(
`.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  position: relative;
  background: var(--bg-primary);
  z-index: 1;
}

.main-area::before {
  content: '';
  position: absolute;
  top: -150px;
  right: -150px;
  width: 500px;
  height: 500px;
  background: radial-gradient(circle, rgba(235, 126, 172, 0.15) 0%, transparent 60%);
  z-index: -1;
  pointer-events: none;
}

.main-area::after {
  content: '';
  position: absolute;
  bottom: -200px;
  left: -200px;
  width: 600px;
  height: 600px;
  background: radial-gradient(circle, rgba(104, 117, 245, 0.12) 0%, transparent 60%);
  z-index: -1;
  pointer-events: none;
}`,
`.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  position: relative;
}`
);

css = css.replace(
`.main-header {
  height: calc(var(--header-height) - 16px);
  margin: 16px 20px;
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: color-mix(in srgb, var(--bg-card) 85%, transparent);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid var(--border-subtle);
  border-radius: 100px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.04);
  position: sticky;
  top: 16px;
  z-index: 50;
}`,
`.main-header {
  height: var(--header-height);
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-subtle);
}`
);

css = css.replace(
`.quick-action {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 20px;
  cursor: pointer;
  transition: all var(--transition-normal);
  text-align: left;
  font-family: var(--font-sans);
  animation: qaFadeIn 0.4s ease both;
}`,
`.quick-action {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  cursor: pointer;
  transition: all var(--transition-fast);
  text-align: left;
  font-family: var(--font-sans);
  animation: qaFadeIn 0.4s ease both;
}`
);

css = css.replace(
`.message.user .message-content {
  background: var(--text-primary);
  color: var(--bg-primary);
  padding: 14px 20px;
  border-radius: 24px;
  border-bottom-right-radius: 4px;
  font-size: 15px;
  line-height: 1.5;
  max-width: 80%;
  width: fit-content;
  box-shadow: inset 0 2px 8px rgba(255,255,255,0.15), 0 4px 16px rgba(0,0,0,0.08);
}`,
`.message.user .message-content {
  background: var(--bg-user-bubble);
  padding: 10px 16px;
  border-radius: 16px;
  font-size: 15px;
  line-height: 1.5;
  color: var(--text-primary);
  max-width: 80%;
  width: fit-content;
}`
);

css = css.replace(
`.pub-card-v2 {
  animation: cardSlideIn 0.35s ease both;
  border-radius: 20px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-card);
  transition: all var(--transition-normal);
  overflow: hidden;
  box-shadow: 0 4px 24px rgba(0,0,0,0.02);
}`,
`.pub-card-v2 {
  animation: cardSlideIn 0.35s ease both;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-primary);
  transition: all var(--transition-fast);
  overflow: hidden;
}`
);

css = css.replace(
`.app-layout.has-right-sidebar .main-area {
  padding-right: 16px;
}`,
``
);

fs.writeFileSync('index.css', css);
