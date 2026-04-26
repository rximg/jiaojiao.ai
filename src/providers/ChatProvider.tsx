import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import type { Message, TodoItem, StepResult, BatchProgress } from '../types/types';
import { isRenderableMessage, mergeToolCallsIntoMessages, sanitizeMessages } from '../lib/chat-messages';

interface AgentErrorState {
  message: string;
  onRetry: () => void;
}

interface ChatContextType {
  messages: Message[];
  todos: TodoItem[];
  /** 当前待确认的 HITL 请求（统一人工确认通道） */
  pendingHitlRequest: { requestId: string; actionType: string; payload: Record<string, unknown>; timeout: number } | null;
  quotaError: { message: string; error: string } | null;
  agentError: AgentErrorState | null;
  isLoading: boolean;
  currentSessionId: string | null;
  lastArtifactTime: number; // 最后一次生成产物的时间戳，用于触发刷新
  /** 当前会话下 TTS 实时进度（聊天框内独立一行显示），流结束或会话切换时清空 */
  ttsProgressLive: { current: number; total: number } | null;
  sendMessage: (text: string, sessionIdOverride?: string) => Promise<void>;
  respondConfirm: (requestId: string, approved: boolean, editedPayload?: Record<string, unknown>, cancelReason?: string) => Promise<void>;
  dismissQuotaError: () => void;
  dismissAgentError: () => void;
  stopStream: () => Promise<void>;
  createNewSession: (title?: string, prompt?: string, caseId?: string) => Promise<string>;
  loadSession: (sessionId: string) => Promise<void>;
  resetSession: () => Promise<void>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [pendingHitlRequest, setPendingHitlRequest] = useState<{ requestId: string; actionType: string; payload: Record<string, unknown>; timeout: number } | null>(null);
  const [quotaError, setQuotaError] = useState<{ message: string; error: string } | null>(null);
  const [agentError, setAgentError] = useState<AgentErrorState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [lastArtifactTime, setLastArtifactTime] = useState<number>(0);
  /** TTS 进度：在聊天框内单独显示一行「已生成 x/n 份文件」，流结束清空 */
  const [ttsProgressLive, setTtsProgressLive] = useState<{ current: number; total: number } | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(false); // 防止并发切换 session
  const skipNextAutoSaveRef = useRef(false);
  const allMessagesRef = useRef<Message[]>([]);
  const pendingHitlRequestRef = useRef<typeof pendingHitlRequest>(null);

  useEffect(() => {
    pendingHitlRequestRef.current = pendingHitlRequest;
  }, [pendingHitlRequest]);

  // 自动保存消息和todos到session
  useEffect(() => {
    if (!currentSessionId || messages.length === 0 || isLoadingSession) return;
    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      return;
    }
    
    const saveSession = async () => {
      try {
        await window.electronAPI.session.update(currentSessionId, {
          messages,
          todos,
        });
        console.log('[ChatProvider] Auto-saved session');
      } catch (error) {
        console.error('[ChatProvider] Failed to save session:', error);
      }
    };
    
    // 减少延迟保存时间，从1000ms改为300ms，确保用户消息快速持久化
    const timer = setTimeout(saveSession, 300);
    return () => clearTimeout(timer);
  }, [currentSessionId, messages, todos, isLoadingSession]);

  // 从消息内容中提取artifacts
  const extractArtifacts = useCallback((content: string): TodoItem['artifacts'] | undefined => {
    const artifacts: TodoItem['artifacts'] = {};
    let hasArtifacts = false;

    // 解析图片路径
    const imageMatches = content.match(/(?:图片：|outputs[/\\]images[/\\])[^\n\s]+\.(?:png|jpg|jpeg)/gi);
    if (imageMatches) {
      artifacts.images = imageMatches.map(path => ({
        path: path.replace(/^图片：/, '').trim()
      }));
      hasArtifacts = true;
    }

    // 解析音频路径
    const audioMatches = content.match(/(?:音频：|outputs[/\\]audio[/\\])[^\n\s]+\.(?:mp3|wav)/gi);
    if (audioMatches) {
      artifacts.audio = audioMatches.map(path => ({
        path: path.replace(/^音频：/, '').trim()
      }));
      hasArtifacts = true;
    }

    // 解析LLM输出：优先JSON，其次纯文本
    const jsonMatch = content.match(/\{[\s\S]*?"(?:age|theme|text|style|language)"[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        artifacts.llmOutput = JSON.parse(jsonMatch[0]);
        hasArtifacts = true;
      } catch (e) {
        console.warn('[ChatProvider] Failed to parse JSON:', e);
      }
    } else if (content && content.length > 20 && content.length < 2000 && !content.includes('outputs')) {
      // 如果是合理长度的纯文本（不是路径信息），作为llmOutput
      artifacts.llmOutput = { text: content };
      hasArtifacts = true;
    }

    return hasArtifacts ? artifacts : undefined;
  }, []);

  // 匹配todos和消息，附加artifacts
  const attachArtifactsToTodos = useCallback((currentTodos: TodoItem[], allMessages: Message[]) => {
    if (allMessages.length === 0) return currentTodos;

    return currentTodos.map((todo, index) => {
      // 如果已有artifacts，跳过
      if (todo.artifacts && Object.keys(todo.artifacts).length > 0) {
        return todo;
      }

      // 只为completed状态的todo附加artifacts
      if (todo.status !== 'completed') {
        return todo;
      }

      // 尝试找到对应的消息（按顺序，第n个completed todo对应第n个assistant消息）
      const assistantMessages = allMessages.filter((m) => m.role === 'assistant' && isRenderableMessage(m));
      const completedIndex = currentTodos.slice(0, index + 1).filter(t => t.status === 'completed').length - 1;
      
      if (assistantMessages[completedIndex]) {
        const artifacts = extractArtifacts(assistantMessages[completedIndex].content);
        if (artifacts) {
          console.log('[ChatProvider] Attaching artifacts to todo:', todo.content, artifacts);
          return { ...todo, artifacts };
        }
      }

      return todo;
    });
  }, [extractArtifacts]);

  useEffect(() => {
    // 监听 Agent 消息
    const handleMessage = (data: any) => {
      // threadId 即 sessionId，直接使用
      if (data.threadId === currentSessionId) {
        const newMessages = data.messages.map((msg: any) => ({
          id: msg.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          role: msg.role || 'assistant',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          timestamp: new Date(),
          ...(Array.isArray(msg.stepResults) && msg.stepResults.length > 0 ? { stepResults: msg.stepResults } : {}),
        }));
        
        setMessages((prev) => {
          // 去重：新消息按 id 替换已有消息，避免流式更新时重复
          // 同时保留已有消息上的运行时字段（batchOperation、stepResults 等），防止被刷新覆盖
          const newMessageIds = new Set(newMessages.map((m: Message) => m.id));
          const prevDeduped = prev.filter((m: Message) => !newMessageIds.has(m.id));
          const mergedNew = newMessages.map((newMsg: Message) => {
            const existing = prev.find((m: Message) => m.id === newMsg.id);
            return existing
              ? {
                  ...existing,   // 保留 batchOperation、stepResults、ttsProgress 等运行时字段
                  ...newMsg,     // 新消息覆盖 content、role 等基础字段
                }
              : newMsg;
          });
          const updated = sanitizeMessages([...prevDeduped, ...mergedNew]);
          allMessagesRef.current = updated;
          return updated;
        });
        
        // 当有新消息时，尝试匹配并附加artifacts到todos
        setTodos(prev => attachArtifactsToTodos(prev, allMessagesRef.current));
      }
    };

    const handleTodo = (data: any) => {
      console.log('[renderer] received todoUpdate:', data);
      
      const newTodos = data.todos || [];
      
      // threadId 即 sessionId
      if (data.threadId === currentSessionId) {
        console.log('[renderer] updating todos to:', newTodos);
        setTodos(attachArtifactsToTodos(newTodos, allMessagesRef.current));
      } else {
        console.log('[renderer] skipping todo update, wrong session:', data.threadId, 'vs', currentSessionId);
      }
    };

    const handleHitlConfirm = (data: { requestId: string; actionType: string; payload: Record<string, unknown>; timeout: number }) => {
      console.log('[renderer] received hitl:confirmRequest:', data);
      setPendingHitlRequest(data);
    };

    const handleStepResult = (data: { threadId: string; messageId: string; stepResults: Array<{ type: 'image' | 'audio' | 'document'; payload: Record<string, unknown> }> }) => {
      if (data.threadId !== currentSessionId) return;
      const stepResults = data.stepResults as StepResult[];
      setMessages((prev) =>
        prev.map((m) => (m.id === data.messageId ? { ...m, stepResults } : m))
      );
      allMessagesRef.current = allMessagesRef.current.map((m) =>
        m.id === data.messageId ? { ...m, stepResults } : m
      );
    };

    const handleToolCall = (data: { threadId: string; messageId?: string; toolCalls: Message['toolCalls'] }) => {
      if (data.threadId !== currentSessionId || !data.toolCalls || data.toolCalls.length === 0) {
        return;
      }

      console.log('[ChatProvider] Tool called:', data);

      setMessages((prev) => {
        const updated = sanitizeMessages(
          mergeToolCallsIntoMessages(prev, data.messageId, data.toolCalls)
        );
        allMessagesRef.current = updated;
        return updated;
      });
    };

    const handleTtsProgress = (data: { threadId: string; messageId?: string; toolCallId?: string; current: number; total: number; path: string }) => {
      if (data.threadId !== currentSessionId) return;
      setTtsProgressLive({ current: data.current, total: data.total });
      setMessages((prev) => {
        const lastAssistantIdx = prev.map((m, i) => (m.role === 'assistant' ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
        if (lastAssistantIdx < 0) return prev;
        const targetId = data.messageId ?? prev[lastAssistantIdx].id;
        return prev.map((m) => {
          if (m.role !== 'assistant' || m.id !== targetId) return m;
          return { ...m, ttsProgress: { current: data.current, total: data.total } };
        });
      });
      allMessagesRef.current = allMessagesRef.current.map((m) => {
        if (m.role !== 'assistant') return m;
        const lastId = allMessagesRef.current.filter((x) => x.role === 'assistant').pop()?.id;
        const targetId = data.messageId ?? lastId;
        if (m.id !== targetId) return m;
        return { ...m, ttsProgress: { current: data.current, total: data.total } };
      });
    };

    const handleQuotaExceeded = (data: any) => {
      console.error('[ChatProvider] Quota exceeded:', data);
      setQuotaError(data);
      setIsLoading(false);
      setTtsProgressLive(null);
    };

    const handleBatchProgress = (data: { threadId: string; messageId?: string; toolCallId?: string; progress: BatchProgress }) => {
      if (data.threadId !== currentSessionId) return;
      const { progress } = data;

      const applyUpdate = (m: Message, targetId: string): Message => {
        if (m.id !== targetId) return m;

        const existing = m.batchOperation;

        // 构建/更新 subTasks 列表
        const subTasks = existing?.subTasks
          ? [...existing.subTasks]
          : Array.from({ length: progress.total }, (_, i) => ({
              index: i + 1,
              status: 'pending' as const,
            }));

        if (progress.currentSubTask) {
          const idx = progress.currentSubTask.index - 1;
          if (idx >= 0 && idx < subTasks.length) {
            subTasks[idx] = { ...subTasks[idx], ...progress.currentSubTask };
          }
        }

        return {
          ...m,
          batchOperation: {
            batchId: progress.batchId,
            toolName: progress.toolName,
            total: progress.total,
            current: progress.current,
            subTasks,
          },
        };
      };

      setMessages((prev) => {
        // 优先使用后端传来的 messageId（由 runCtx.messageId 设定），否则回退到最后一条 assistant 消息
        const lastAssistantMsg = prev.filter((m) => m.role === 'assistant').pop();
        const targetId = data.messageId ?? lastAssistantMsg?.id;
        if (!targetId) return prev;
        return prev.map((m) => applyUpdate(m, targetId));
      });

      // 同步更新 allMessagesRef（与 handleTtsProgress 保持一致）
      const lastAssistantInRef = allMessagesRef.current.filter((m) => m.role === 'assistant').pop();
      const refTargetId = data.messageId ?? lastAssistantInRef?.id;
      if (refTargetId) {
        allMessagesRef.current = allMessagesRef.current.map((m) => applyUpdate(m, refTargetId));
      }
    };

    window.electronAPI.agent.onMessage(handleMessage);
    if (typeof window.electronAPI.agent.onStepResult === 'function') {
      window.electronAPI.agent.onStepResult(handleStepResult);
    }
    window.electronAPI.agent.onTodoUpdate((data) => {
      handleTodo(data);
      // Todo 更新时刷新文件系统显示
      setLastArtifactTime(Date.now());
    });
    window.electronAPI.agent.onToolCall(handleToolCall);
    if (typeof window.electronAPI.agent.onTtsProgress === 'function') {
      window.electronAPI.agent.onTtsProgress(handleTtsProgress);
    }

    if (typeof window.electronAPI.agent.onBatchProgress === 'function') {
      window.electronAPI.agent.onBatchProgress(handleBatchProgress);
    }

    if (typeof window.electronAPI.agent.onQuotaExceeded === 'function') {
      window.electronAPI.agent.onQuotaExceeded(handleQuotaExceeded);
    }
    if (typeof window.electronAPI.agent.onWorkspaceFileAdded === 'function') {
      window.electronAPI.agent.onWorkspaceFileAdded(() => setLastArtifactTime(Date.now()));
    }

    if (typeof window.electronAPI.hitl?.onConfirmRequest === 'function') {
      window.electronAPI.hitl.onConfirmRequest(handleHitlConfirm);
    } else {
      // eslint-disable-next-line no-console
      console.warn('[hitl] onConfirmRequest not available in preload');
    }

    return () => {
      // 无法移除监听，因为 preload 未暴露 off；依赖单次注册
    };
  }, [attachArtifactsToTodos, currentSessionId]);

  const respondConfirm = useCallback(async (requestId: string, approved: boolean, editedPayload?: Record<string, unknown>, cancelReason?: string) => {
    const pending = pendingHitlRequestRef.current;
    const finalPayload = approved && editedPayload ? { ...pending?.payload, ...editedPayload } : pending?.payload ?? {};
    if (pending && pending.requestId === requestId) {
      const hitlMessage: Message = {
        id: `hitl-${requestId}`,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        hitlBlock: {
          requestId: pending.requestId,
          actionType: pending.actionType,
          payload: finalPayload,
          approved,
        },
      };
      setMessages((prev) => [...prev, hitlMessage]);
      allMessagesRef.current = [...allMessagesRef.current, hitlMessage];
    }
    setPendingHitlRequest(null);
    console.log('[renderer] responding to HITL with:', requestId, approved, editedPayload ? '(with edited payload)' : '', cancelReason ? '(cancel reason)' : '');
    if (typeof window.electronAPI.hitl?.respond === 'function') {
      const response: { approved: boolean; payload?: Record<string, unknown>; reason?: string } = { approved };
      if (approved && editedPayload && Object.keys(editedPayload).length > 0) {
        response.payload = editedPayload;
      }
      if (!approved && cancelReason?.trim()) {
        response.reason = cancelReason.trim();
      }
      await window.electronAPI.hitl.respond(requestId, response);
    } else {
      console.warn('[hitl] respond not available in preload');
    }
  }, []);

  const dismissQuotaError = useCallback(() => {
    setQuotaError(null);
  }, []);

  const createNewSession = useCallback(async (title?: string, prompt?: string, caseId?: string) => {
    try {
      // 如果已经有 sessionId，先检查是否真的需要创建新 session
      // 这个检查由调用方负责，这里直接创建
      console.log('[ChatProvider] Creating new session:', { title, caseId });
      const result = await window.electronAPI.session.create(title, prompt, caseId);
      const { sessionId } = result;
      console.log('[ChatProvider] Session created:', sessionId);
      setCurrentSessionId(sessionId);
      // 清空消息和todos
      setMessages([]);
      setTodos([]);
      return sessionId;
    } catch (error) {
      console.error('Failed to create session:', error);
      throw error;
    }
  }, []);

  const sendMessage = useCallback(async (text: string, sessionIdOverride?: string) => {
    console.log('[ChatProvider] sendMessage called with:', {
      text,
      currentSessionId,
      sessionIdOverride,
    });

    // 无 session 时不创建、不发送，由界面回退到欢迎页
    const sessionId = sessionIdOverride ?? currentSessionId;
    if (!sessionId) {
      console.warn('[ChatProvider] No session, cannot send; UI should navigate to welcome.');
      return;
    }

    // 添加用户消息
    const userMessage: Message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    allMessagesRef.current = [...allMessagesRef.current, userMessage];

    setIsLoading(true);
    setAgentError(null);
    try {
      // 现在只需传递 sessionId，threadId 已统一
      await window.electronAPI.agent.sendMessage(text, sessionId);
      console.log('[renderer] message sent with sessionId:', sessionId);
    } catch (error) {
      console.error('Failed to send message:', error);
      // 异常时立即停止流式传输（直接调用 API，避免循环依赖）
      try {
        await window.electronAPI.agent.stopStream();
      } catch (stopError) {
        console.warn('Failed to stop stream:', stopError);
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      // 异常时直接中断，不提供自动重试，仅显示错误信息
      setAgentError({
        message: errorMessage,
        onRetry: () => {
          // 不自动执行，仅用于兼容接口
          setAgentError(null);
        },
      });
      setIsLoading(false); // 确保停止加载状态
      setTtsProgressLive(null);
    } finally {
      setIsLoading(false);
      setTtsProgressLive(null);
    }
  }, [currentSessionId]);

  const dismissAgentError = useCallback(() => {
    setAgentError(null);
  }, []);

  const stopStream = useCallback(async () => {
    await window.electronAPI.agent.stopStream();
    setIsLoading(false);
    setTtsProgressLive(null);
  }, []);

  const loadSession = useCallback(async (sessionId: string) => {
    // 防止并发切换
    if (isLoadingSession) {
      console.warn('[ChatProvider] Already loading a session, ignoring request');
      return;
    }
    
    try {
      setIsLoadingSession(true);
      console.log('[ChatProvider] Loading session:', sessionId);

      // 切换会话前停止流式请求并清理加载状态，避免输入框被锁住
      try {
        await window.electronAPI.agent.stopStream();
      } catch (error) {
        console.warn('[ChatProvider] Failed to stop stream on loadSession:', error);
      }
      setIsLoading(false);
      setAgentError(null);
      setPendingHitlRequest(null);
      setTtsProgressLive(null);
      
      // 单 session 模式：切换 session 前先关闭旧 runtime
      if (currentSessionId && currentSessionId !== sessionId) {
        try {
          console.log('[ChatProvider] Closing old runtime:', currentSessionId);
          await window.electronAPI.session.closeRuntime(currentSessionId);
        } catch (error) {
          console.error('[ChatProvider] Failed to close old runtime:', error);
          // 不阻断流程，继续加载新 session
        }
      }
      
      setCurrentSessionId(sessionId);
      // 仅查看历史会话时不应触发 updatedAt 刷新
      skipNextAutoSaveRef.current = true;
      
      // 从session加载历史数据
      const sessionData = await window.electronAPI.session.get(sessionId);
      console.log('[ChatProvider] Loaded session data:', sessionData);
      
      // 加载消息（保留 hitlBlock，标准化 timestamp 为 Date）
      if (sessionData.messages && Array.isArray(sessionData.messages)) {
        const normalized = sanitizeMessages(sessionData.messages.map((m: Message & { timestamp?: Date | string }) => ({
          ...m,
          timestamp: m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp || Date.now()),
        })));
        setMessages(normalized);
        allMessagesRef.current = normalized;
      } else {
        setMessages([]);
        allMessagesRef.current = [];
      }
      
      // 加载todos
      if (sessionData.todos && Array.isArray(sessionData.todos)) {
        setTodos(sessionData.todos);
      } else {
        setTodos([]);
      }
    } catch (error) {
      console.error('Failed to load session:', error);
      setIsLoadingSession(false);
      
      // 会话元数据不存在，弹窗提示并清理状态
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Session not found')) {
        alert(`会话加载失败：该会话的元数据已损坏或丢失\n\n会话ID: ${sessionId}\n\n请返回主页重新开始。`);
      } else {
        alert(`会话加载失败：${errorMessage}`);
      }
      
      // 清理状态
      setCurrentSessionId(null);
      setMessages([]);
      setTodos([]);
      allMessagesRef.current = [];
      
      throw error;
    } finally {
      setIsLoadingSession(false);
    }
  }, [currentSessionId, isLoadingSession]);

  const resetSession = useCallback(async () => {
    console.log('[ChatProvider] Resetting session');

    // 先结束可能挂起的 HITL 等待，避免流式调用悬挂
    const pending = pendingHitlRequestRef.current;
    if (pending && typeof window.electronAPI.hitl?.respond === 'function') {
      try {
        await window.electronAPI.hitl.respond(pending.requestId, {
          approved: false,
          reason: 'Cancelled by navigation',
        });
      } catch (error) {
        console.warn('[ChatProvider] Failed to cancel pending HITL on reset:', error);
      }
    }

    // 再中止当前流式执行，避免切回欢迎页后旧请求占用状态
    try {
      await window.electronAPI.agent.stopStream();
    } catch (error) {
      console.warn('[ChatProvider] Failed to stop stream on reset:', error);
    }
    
    // 显式关闭后端 runtime（如果有当前 session）
    if (currentSessionId) {
      try {
        await window.electronAPI.session.closeRuntime(currentSessionId);
        console.log('[ChatProvider] Runtime closed for session:', currentSessionId);
      } catch (error) {
        console.error('[ChatProvider] Failed to close runtime:', error);
      }
    }
    
    setCurrentSessionId(null);
    setPendingHitlRequest(null);
    setIsLoading(false);
    setTtsProgressLive(null);
    setMessages([]);
    setTodos([]);
    allMessagesRef.current = [];
  }, [currentSessionId]);

  return (
    <ChatContext.Provider
      value={{
        messages,
        todos,
        pendingHitlRequest,
        quotaError,
        agentError,
        isLoading,
        currentSessionId,
        lastArtifactTime,
        ttsProgressLive,
        sendMessage,
        respondConfirm,
        dismissQuotaError,
        dismissAgentError,
        stopStream,
        createNewSession,
        loadSession,
        resetSession,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}
