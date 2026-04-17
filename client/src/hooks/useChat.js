import { useState, useCallback, useRef, useEffect } from 'react';
import { sendMessageStream, getConversations, getConversation, createConversation, deleteConversation } from '../services/api';

export function useChat() {
  const [messages, setMessages] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [stepMessage, setStepMessage] = useState('');
  const [expandedQueries, setExpandedQueries] = useState([]);
  const [retrievalStats, setRetrievalStats] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => { loadConversations(); }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const loadConversations = useCallback(async () => {
    try {
      const data = await getConversations();
      setConversations(data);
    } catch (e) {
      console.error('Failed to load conversations:', e);
    }
  }, []);

  const loadConversation = useCallback(async (id) => {
    try {
      const data = await getConversation(id);
      setCurrentConversationId(id);

      // Map DB message format to UI message format
      const uiMessages = (data.messages || []).map(msg => ({
        role: msg.role,
        content: msg.content,
        // DB response structure matches what MessageBubble expects
        response: msg.response || null,
        pipelineMetrics: msg.pipelineMetrics || null,
        isError: false,
        isNew: false,
        timestamp: msg.timestamp
      }));

      setMessages(uiMessages);
      setExpandedQueries([]);
      setRetrievalStats(null);
    } catch (e) {
      console.error('Failed to load conversation:', e);
    }
  }, []);

  const startNewChat = useCallback(async () => {
    try {
      const data = await createConversation();
      setCurrentConversationId(data.conversationId);
      setMessages([]);
      setExpandedQueries([]);
      setRetrievalStats(null);
      await loadConversations();
      return data.conversationId;
    } catch (e) {
      console.error('Failed to create conversation:', e);
    }
  }, [loadConversations]);

  const removeConversation = useCallback(async (id) => {
    try {
      await deleteConversation(id);
      if (currentConversationId === id) {
        setCurrentConversationId(null);
        setMessages([]);
        setExpandedQueries([]);
        setRetrievalStats(null);
      }
      await loadConversations();
    } catch (e) {
      console.error('Failed to delete conversation:', e);
    }
  }, [currentConversationId, loadConversations]);

  /**
   * Send a message using the SSE streaming endpoint.
   * Loading steps are server-driven (accurate to actual pipeline progress).
   */
  const send = useCallback(async (input, isStructured = false) => {
    if (loading) return;

    let convId = currentConversationId;
    if (!convId) {
      const data = await createConversation();
      convId = data.conversationId;
      setCurrentConversationId(convId);
    }

    // Add user message immediately
    const userMsg = {
      role: 'user',
      content: isStructured
        ? `🏥 ${input.patientName ? input.patientName + ' — ' : ''}${input.disease}${input.query ? ' → ' + input.query : ''}${input.location ? ' 📍 ' + input.location : ''}`
        : input,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    setLoadingStep(1);
    setStepMessage('Expanding query with AI...');
    setExpandedQueries([]);
    setRetrievalStats(null);

    try {
      let result = null;

      for await (const { event, data } of sendMessageStream(convId, input, isStructured)) {
        switch (event) {
          case 'step':
            setLoadingStep(data.step);
            setStepMessage(data.message || '');
            break;
          case 'expanded':
            // Show expanded queries ASAP
            setExpandedQueries(data.queries || []);
            break;
          case 'retrieved':
            setRetrievalStats(data);
            break;
          case 'result':
            result = data;
            break;
          case 'done':
            break;
          case 'error':
            throw new Error(data.message || 'Server error');
          default:
            break;
        }
      }

      if (result) {
        let assistantMsg;
        if (result.isConversational) {
          assistantMsg = {
            role: 'assistant',
            content: result.content,
            response: null,
            pipelineMetrics: null,
            isNew: true,
            timestamp: new Date()
          };
        } else {
          assistantMsg = {
            role: 'assistant',
            content: result.conditionOverview || '',
            response: {
              conditionOverview: result.conditionOverview,
              researchInsights: result.researchInsights,
              clinicalTrialsSummary: result.clinicalTrialsSummary,
              personalizedRecommendation: result.personalizedRecommendation,
              keyFindings: result.keyFindings,
              publications: result.publications,
              clinicalTrials: result.clinicalTrials,
              researchers: result.researchers || []
            },
            pipelineMetrics: result.pipelineMetrics,
            isNew: true,
            timestamp: new Date()
          };
        }
        setMessages(prev => [...prev, assistantMsg]);
      }

      await loadConversations();
    } catch (e) {
      console.error('Send error:', e);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, there was an error: ${e.message}. Please try again.`,
        isError: true,
        timestamp: new Date()
      }]);
    } finally {
      setLoading(false);
      setLoadingStep(0);
      setStepMessage('');
    }
  }, [currentConversationId, loading, loadConversations]);

  return {
    messages,
    conversations,
    currentConversationId,
    loading,
    loadingStep,
    stepMessage,
    expandedQueries,
    retrievalStats,
    messagesEndRef,
    send,
    startNewChat,
    loadConversation,
    removeConversation
  };
}
