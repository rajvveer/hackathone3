import React, { useState, useEffect } from 'react';

export default function Typewriter({ text, speed = 10, delay = 0, disabled = false }) {
  const [displayedText, setDisplayedText] = useState(disabled ? (text || '') : '');
  const [isStarted, setIsStarted] = useState(false);

  // Handle delay
  useEffect(() => {
    if (disabled || !text) {
      setDisplayedText(text || '');
      return;
    }
    
    const delayTimer = setTimeout(() => {
      setIsStarted(true);
    }, delay);

    return () => clearTimeout(delayTimer);
  }, [delay, disabled, text]);

  // Handle typing
  useEffect(() => {
    if (!isStarted || disabled || !text) return;

    let currentIndex = displayedText.length;
    if (currentIndex >= text.length) return;

    const typeTimer = setTimeout(() => {
      // Advance by 3 characters at a time for modern, fast feeling but visible streaming
      // 3 chars every 10ms = 300 chars per second
      const nextIndex = Math.min(currentIndex + 3, text.length);
      setDisplayedText(text.substring(0, nextIndex));
    }, speed);

    return () => clearTimeout(typeTimer);
  }, [displayedText, isStarted, disabled, text, speed]);

  return <span>{displayedText}</span>;
}
