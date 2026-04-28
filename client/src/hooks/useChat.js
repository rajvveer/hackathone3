import { useState, useCallback, useRef, useEffect } from 'react';
import { sendMessageStream, requestClarification, getConversations, getConversation, createConversation, deleteConversation, loginWithGoogle, migrateConversations, uploadMedicalFile } from '../services/api';
import { jwtDecode } from 'jwt-decode';

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

  // Follow-up questions state
  const [followUp, setFollowUp] = useState(null);
  // followUp shape: { originalQuery, questions, currentIndex, answers }

  const [user, setUser] = useState(() => {
    const token = localStorage.getItem('curalink-token');
    if (token) {
      try {
        return jwtDecode(token);
      } catch (e) {
        localStorage.removeItem('curalink-token');
      }
    }
    return null;
  });

  const getLocalIds = () => {
    try { return JSON.parse(localStorage.getItem('curalink-anonymous-ids') || '[]'); } 
    catch { return []; }
  };
  
  const saveLocalId = (id) => {
    const ids = getLocalIds();
    if (!ids.includes(id)) {
      ids.push(id);
      localStorage.setItem('curalink-anonymous-ids', JSON.stringify(ids));
    }
  };
  
  const removeLocalId = (id) => {
    const ids = getLocalIds();
    localStorage.setItem('curalink-anonymous-ids', JSON.stringify(ids.filter(i => i !== id)));
  };

  useEffect(() => { loadConversations(); }, [user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const loadConversations = useCallback(async () => {
    try {
      const data = await getConversations(user ? [] : getLocalIds());
      setConversations(data);
    } catch (e) {
      console.error('Failed to load conversations:', e);
    }
  }, [user]);

  const loadConversation = useCallback(async (id) => {
    try {
      const data = await getConversation(id);
      setCurrentConversationId(id);

      // Map DB message format to UI message format
      const uiMessages = (data.messages || []).map(msg => {
        // Reconstruct response with isFileAnalysis if it was stored at message level (legacy)
        let response = msg.response || null;
        if (response && !response.isFileAnalysis && msg.isFileAnalysis) {
          response = { ...response, isFileAnalysis: true };
        }

        return {
          role: msg.role,
          content: msg.content,
          structuredInput: msg.structuredInput || null,
          fileAttachment: msg.fileAttachment || null,
          response,
          pipelineMetrics: msg.pipelineMetrics || null,
          isError: false,
          isNew: false,
          timestamp: msg.timestamp
        };
      });

      setMessages(uiMessages);
      setExpandedQueries([]);
      setRetrievalStats(null);
    } catch (e) {
      console.error('Failed to load conversation:', e);
    }
  }, []);

  const startNewChat = useCallback(async () => {
    // Prevent creating multiple empty chats if the current one is already empty
    if (messages.length === 0 && currentConversationId) {
      return currentConversationId;
    }

    try {
      const data = await createConversation();
      if (!user) saveLocalId(data.conversationId);
      setCurrentConversationId(data.conversationId);
      setMessages([]);
      setExpandedQueries([]);
      setRetrievalStats(null);
      await loadConversations();
      return data.conversationId;
    } catch (e) {
      console.error('Failed to create new conversation:', e);
    }
  }, [user, messages.length, currentConversationId, loadConversations]);

  const removeConversation = useCallback(async (id) => {
    try {
      await deleteConversation(id);
      if (!user) removeLocalId(id);
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

  const loginUser = useCallback(async (credential) => {
    try {
      const data = await loginWithGoogle(credential);
      localStorage.setItem('curalink-token', data.token);
      // Try to migrate local chats to the DB before setting user
      const localIds = getLocalIds();
      if (localIds.length > 0) {
         try {
            await migrateConversations(localIds);
            localStorage.removeItem('curalink-anonymous-ids');
         } catch (err) {
            console.error('Migration failed:', err);
         }
      }
      setUser(jwtDecode(data.token));
      // Reload conversations implicitly happens via useEffect since user changed
    } catch (e) {
      console.error('Login failed', e);
      throw e;
    }
  }, []);

  const logoutUser = useCallback(() => {
    localStorage.removeItem('curalink-token');
    setUser(null);
    setConversations([]);
    setMessages([]);
    setCurrentConversationId(null);
  }, []);

  /**
   * Send query to the SSE streaming research pipeline.
   */
  const sendToResearchPipeline = useCallback(async (input, isStructured = false) => {
    let convId = currentConversationId;
    if (!convId) {
      const data = await createConversation();
      convId = data.conversationId;
      if (!user) saveLocalId(convId);
      setCurrentConversationId(convId);
    }

    // For enriched queries (post-follow-up), add user message if not already shown
    if (typeof input === 'string' && input.includes('\nAdditional Context:')) {
      // Don't add another user message — original was already added
    } else if (isStructured) {
      const userMsg = {
        role: 'user',
        content: `🏥 ${input.patientName ? input.patientName + ' — ' : ''}${input.disease}${input.query ? ' → ' + input.query : ''}${input.location ? ' 📍 ' + input.location : ''}`,
        structuredInput: input,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, userMsg]);
    }

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
  }, [currentConversationId, loadConversations, user]);



  /**
   * Send a message — first requests follow-up clarification questions,
   * then after user answers, sends enriched query to the pipeline.
   */
  const send = useCallback(async (input, isStructured = false, forceDrop = false) => {
    if (loading && !forceDrop) return;

    // Structured queries skip clarification (already have full context)
    if (isStructured) {
      return sendToResearchPipeline(input, true);
    }

    // Add user message immediately
    const userMsg = {
      role: 'user',
      content: input,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    const isFirstQuery = messages.length === 0;

    try {
      if (isFirstQuery) {
        // Request clarification questions from backend
        const clarifyResult = await requestClarification(input);

        if (clarifyResult.type === 'conversational') {
          // Conversational (greeting) — show reply directly
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: clarifyResult.content,
            response: null,
            pipelineMetrics: null,
            isNew: true,
            timestamp: new Date()
          }]);
          setLoading(false);
          return;
        }

        if (clarifyResult.type === 'clarification' && clarifyResult.questions?.length > 0) {
          // Show follow-up questions
          setFollowUp({
            originalQuery: input,
            questions: clarifyResult.questions,
            currentIndex: 0,
            answers: []
          });
          setLoading(false);
          return;
        }
      }

      // Fallback or subsequent query: no questions generated, go straight to pipeline
      setLoading(false);
      return sendToResearchPipeline(input, false);
    } catch (e) {
      console.error('Clarification error:', e);
      // On error, fall through to normal pipeline
      setLoading(false);
      return sendToResearchPipeline(input, false);
    }
  }, [loading, messages.length, sendToResearchPipeline]);

  /**
   * Submit follow-up answer and advance to next question or trigger research.
   */
  const submitFollowUpAnswer = useCallback((answer) => {
    if (!followUp) return;
    const newAnswers = [...followUp.answers, answer];
    const nextIndex = followUp.currentIndex + 1;

    if (nextIndex >= followUp.questions.length) {
      // All questions answered — trigger research with enriched context
      const enrichedQuery = buildEnrichedQuery(followUp.originalQuery, followUp.questions, newAnswers);
      setFollowUp(null); // Clear follow-up
      sendToResearchPipeline(enrichedQuery, false);
    } else {
      setFollowUp({ ...followUp, currentIndex: nextIndex, answers: newAnswers });
    }
  }, [followUp, sendToResearchPipeline]);

  /**
   * Go back to a previous question in the follow-up flow.
   */
  const goBackFollowUp = useCallback(() => {
    setFollowUp(prev => {
      if (!prev || prev.currentIndex === 0) return prev;
      const newAnswers = prev.answers.slice(0, -1);
      return { ...prev, currentIndex: prev.currentIndex - 1, answers: newAnswers };
    });
  }, []);

  /**
   * Skip follow-up questions and go straight to research with original query.
   */
  const skipFollowUp = useCallback(() => {
    const originalQuery = followUp?.originalQuery;
    setFollowUp(null);
    if (originalQuery) {
      sendToResearchPipeline(originalQuery, false);
    }
  }, [followUp, sendToResearchPipeline]);

  /**
   * Build an enriched query string from original query + follow-up answers.
   */
  function buildEnrichedQuery(originalQuery, questions, answers) {
    let enriched = originalQuery;
    const contextParts = [];
    questions.forEach((q, i) => {
      if (answers[i]) {
        contextParts.push(`${q.question}: ${answers[i]}`);
      }
    });
    if (contextParts.length > 0) {
      enriched += '\n\nAdditional Context:\n' + contextParts.join('\n');
    }
    return enriched;
  }

  /**
   * Upload a medical file (PDF or image) for AI analysis.
   */
  const uploadFile = useCallback(async (file, userQuery = '') => {
    if (loading) return;

    let convId = currentConversationId;
    if (!convId) {
      const data = await createConversation();
      convId = data.conversationId;
      if (!user) saveLocalId(convId);
      setCurrentConversationId(convId);
    }

    // Add user message immediately
    const fileName = file.name;
    const isImage = file.type.startsWith('image/');
    const userMsg = {
      role: 'user',
      content: userQuery
        ? `📎 Uploaded: ${fileName} — "${userQuery}"`
        : `📎 Uploaded: ${fileName}`,
      fileAttachment: { name: fileName, type: file.type, isImage },
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    setLoadingStep(1);
    setStepMessage('Processing your document...');

    try {
      const result = await uploadMedicalFile(convId, file, userQuery);

      const analysis = result.analysis || {};
      const assistantMsg = {
        role: 'assistant',
        content: analysis.summary || 'Document analysis complete.',
        response: {
          ...analysis,
          fileInfo: result.fileInfo,
          isFileAnalysis: true,
          // RAG pipeline results (publications, trials, researchers)
          publications: analysis.publications || [],
          clinicalTrials: analysis.clinicalTrials || [],
          researchers: analysis.researchers || [],
        },
        pipelineMetrics: result.pipelineMetrics,
        isNew: true,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMsg]);
      await loadConversations();
    } catch (e) {
      console.error('File upload error:', e);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Failed to analyze file: ${e.message}`,
        isError: true,
        timestamp: new Date()
      }]);
    } finally {
      setLoading(false);
      setLoadingStep(0);
      setStepMessage('');
    }
  }, [loading, currentConversationId, loadConversations, user]);

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
    uploadFile,
    startNewChat,
    loadConversation,
    removeConversation,
    user,
    loginUser,
    logoutUser,
    // Follow-up questions
    followUp,
    submitFollowUpAnswer,
    goBackFollowUp,
    skipFollowUp
  };
}
