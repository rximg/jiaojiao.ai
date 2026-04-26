import React, { useState, useRef, useCallback, FormEvent, useEffect } from 'react';
import { ArrowUp, Square, Settings, ArrowLeft, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import ChatMessage from './ChatMessage';
import WelcomeMessage from './WelcomeMessage';
import QuickOptions from './QuickOptions';
import HitlConfirmBlock from './HitlConfirmBlock';
import HitlModeDialog, { type HitlPolicy, type HitlMode } from './HitlModeDialog';
import TodoPanel from './TodoPanel';
import WorkspacePanel from './WorkspacePanel';
import { useChat } from '../../providers/ChatProvider';
import { isRenderableMessage } from '../../lib/chat-messages';

interface ChatInterfaceProps {
  loadSessionId: string | null;
  caseIdForNewSession: string | null;
  onBack: () => void;
  onConfigClick: () => void;
}

export default function ChatInterface({
  loadSessionId,
  caseIdForNewSession,
  onBack,
  onConfigClick,
}: ChatInterfaceProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  /** 单行高度，多行时随内容扩展（不超过 max） */
  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 52), 200)}px`;
  }, []);
  useEffect(() => {
    adjustTextareaHeight();
  }, [input, adjustTextareaHeight]);
  const { messages, todos, isLoading, sendMessage, stopStream, currentSessionId, createNewSession, loadSession, resetSession, lastArtifactTime, pendingHitlRequest, respondConfirm, ttsProgressLive } = useChat();
  const visibleMessages = messages.filter((message) => message.role !== 'assistant' || isRenderableMessage(message));
  const waitingForConfirmation = Boolean(pendingHitlRequest);
  const [showWelcome, setShowWelcome] = useState(true);
  const [showWorkspace] = useState(true);
  const [hitlModeOpen, setHitlModeOpen] = useState(false);
  const [hitlPolicy, setHitlPolicy] = useState<HitlPolicy>({ mode: 'strict', allowlist: [] });
  const [hitlPolicyLoading, setHitlPolicyLoading] = useState(false);
  const isCreatingSessionRef = useRef(false);
  /** 进入「案例新会话」时先 reset 一次，避免重复 reset */
  const resetForNullRef = useRef(false);

  // 加载或创建会话
  useEffect(() => {
    if (isCreatingSessionRef.current) {
      console.log('[ChatInterface] Already creating session, skipping...');
      return;
    }

    if (loadSessionId) {
      // 点击历史记录：加载指定的 session
      // 如果当前已经是这个session，跳过重新加载（避免覆盖用户刚输入的消息）
      if (currentSessionId === loadSessionId) {
        console.log('[ChatInterface] Already in session:', loadSessionId, 'skipping reload');
        return;
      }
      resetForNullRef.current = false;
      console.log('[ChatInterface] Loading session:', loadSessionId);
      loadSession(loadSessionId).catch((error) => {
        console.error('[ChatInterface] Failed to load session:', error);
        // 加载失败，返回欢迎页
        onBack();
      });
      setShowWelcome(false);
    } else {
      // loadSessionId === null：点击案例进入聊天
      // 优化：不要提前创建空 session，避免退出后历史里出现“空白会话”。
      // 只在用户第一次发送消息/点击快捷选项时再创建 session。
      if (resetForNullRef.current) {
        return;
      }
      console.log('[ChatInterface] Entered case chat; resetting without creating session yet');
      resetForNullRef.current = true;
      
      (async () => {
        try {
          await resetSession();
        } catch (err) {
          resetForNullRef.current = false;
          console.error('Failed to reset session:', err);
        }
      })();
      
      // 不在这里 setShowWelcome(false)，保留快捷选项，等用户发消息后再隐藏
    }
  }, [loadSessionId, currentSessionId, loadSession, resetSession, onBack]);

  const ensureSessionForSend = useCallback(async (): Promise<string | null> => {
    if (currentSessionId) return currentSessionId;
    if (isCreatingSessionRef.current) return null;
    isCreatingSessionRef.current = true;
    try {
      const result = await createNewSession('新对话', undefined, caseIdForNewSession || undefined);
      return result;
    } catch (err) {
      console.error('[ChatInterface] Failed to create session for send:', err);
      return null;
    } finally {
      isCreatingSessionRef.current = false;
    }
  }, [caseIdForNewSession, createNewSession, currentSessionId]);

  const handleSubmit = useCallback(
    async (e?: FormEvent) => {
      if (e) {
        e.preventDefault();
      }
      const messageText = input.trim();
      // 若有待确认的 HITL，发送 = 新消息：先取消确认再发送
      if (pendingHitlRequest) {
        await respondConfirm(pendingHitlRequest.requestId, false);
        if (!messageText) return;
        if (!currentSessionId) {
          onBack();
          return;
        }
        setShowWelcome(false);
        await sendMessage(messageText);
        setInput('');
        if (textareaRef.current) textareaRef.current.focus();
        return;
      }
      if (!messageText || isLoading) return;
      const sessionId = await ensureSessionForSend();
      if (!sessionId) return;
      setShowWelcome(false);
      await sendMessage(messageText, sessionId);
      setInput('');
      if (textareaRef.current) textareaRef.current.focus();
    },
    [ensureSessionForSend, input, isLoading, pendingHitlRequest, respondConfirm, sendMessage]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleQuickOptionClick = useCallback(
    (option: string) => {
      setInput(option);
      setShowWelcome(false);
      setTimeout(() => handleSubmit(), 0);
    },
    [handleSubmit]
  );

  const handleHitlContinue = useCallback(
    (editedPayload?: Record<string, unknown>) => {
      if (pendingHitlRequest) {
        respondConfirm(pendingHitlRequest.requestId, true, editedPayload);
      }
    },
    [pendingHitlRequest, respondConfirm]
  );

  const handleHitlCancel = useCallback(
    (cancelReason?: string) => {
      if (pendingHitlRequest) {
        respondConfirm(pendingHitlRequest.requestId, false, undefined, cancelReason);
      }
    },
    [pendingHitlRequest, respondConfirm]
  );

  const handleBackClick = useCallback(async () => {
    await resetSession();
    onBack();
  }, [onBack, resetSession]);

  const normalizePolicy = useCallback((raw: unknown): HitlPolicy => {
    const source = (raw ?? {}) as { mode?: unknown; allowlist?: unknown };
    const mode: HitlMode =
      source.mode === 'auto' || source.mode === 'allowlist' || source.mode === 'strict'
        ? source.mode
        : 'strict';
    const allowlist = Array.isArray(source.allowlist)
      ? Array.from(
          new Set(
            source.allowlist
              .filter((item): item is string => typeof item === 'string')
              .map((item) => item.trim())
              .filter(Boolean)
          )
        )
      : [];
    return { mode, allowlist };
  }, []);

  const loadHitlPolicy = useCallback(async () => {
    if (typeof window.electronAPI.hitl?.getPolicy !== 'function') return;
    setHitlPolicyLoading(true);
    try {
      const policy = await window.electronAPI.hitl.getPolicy();
      setHitlPolicy(normalizePolicy(policy));
    } catch (error) {
      console.error('[ChatInterface] Failed to load HITL policy:', error);
    } finally {
      setHitlPolicyLoading(false);
    }
  }, [normalizePolicy]);

  useEffect(() => {
    void loadHitlPolicy();
  }, [loadHitlPolicy]);

  useEffect(() => {
    if (!hitlModeOpen) return;
    void loadHitlPolicy();
  }, [hitlModeOpen, loadHitlPolicy]);

  const handleSetHitlMode = useCallback(
    async (mode: HitlMode) => {
      if (typeof window.electronAPI.hitl?.setMode !== 'function') return;
      setHitlPolicyLoading(true);
      try {
        const policy = await window.electronAPI.hitl.setMode(mode);
        setHitlPolicy(normalizePolicy(policy));
      } catch (error) {
        console.error('[ChatInterface] Failed to set HITL mode:', error);
      } finally {
        setHitlPolicyLoading(false);
      }
    },
    [normalizePolicy]
  );

  const handleAddAllowlist = useCallback(
    async (actionType: string) => {
      if (typeof window.electronAPI.hitl?.addAllowlist !== 'function') return;
      setHitlPolicyLoading(true);
      try {
        const policy = await window.electronAPI.hitl.addAllowlist(actionType);
        setHitlPolicy(normalizePolicy(policy));
      } catch (error) {
        console.error('[ChatInterface] Failed to add HITL allowlist item:', error);
      } finally {
        setHitlPolicyLoading(false);
      }
    },
    [normalizePolicy]
  );

  const handleRemoveAllowlist = useCallback(
    async (actionType: string) => {
      if (typeof window.electronAPI.hitl?.removeAllowlist !== 'function') return;
      setHitlPolicyLoading(true);
      try {
        const policy = await window.electronAPI.hitl.removeAllowlist(actionType);
        setHitlPolicy(normalizePolicy(policy));
      } catch (error) {
        console.error('[ChatInterface] Failed to remove HITL allowlist item:', error);
      } finally {
        setHitlPolicyLoading(false);
      }
    },
    [normalizePolicy]
  );

  const handleClearAllowlist = useCallback(async () => {
    if (typeof window.electronAPI.hitl?.clearAllowlist !== 'function') return;
    setHitlPolicyLoading(true);
    try {
      const policy = await window.electronAPI.hitl.clearAllowlist();
      setHitlPolicy(normalizePolicy(policy));
    } catch (error) {
      console.error('[ChatInterface] Failed to clear HITL allowlist:', error);
    } finally {
      setHitlPolicyLoading(false);
    }
  }, [normalizePolicy]);

  return (
    <div className="flex h-screen flex-col">
      {/* 配置栏 */}
      <header className="flex h-16 items-center justify-between border-b border-border bg-card/80 px-6 shadow-sm">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBackClick}
            disabled={isLoading && !waitingForConfirmation}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            返回
          </Button>
          <h1 className="text-xl font-semibold text-foreground">百科绘本</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setHitlModeOpen(true)}>
            执行模式
          </Button>
          <Button variant="outline" size="sm" onClick={onConfigClick}>
            <Settings className="mr-2 h-4 w-4" />
            配置
          </Button>
        </div>
      </header>

      {/* 主聊天区 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 历史记录面板（可选，暂时隐藏） */}
        <div className="hidden w-64 border-r border-border">
          {/* 历史记录 */}
        </div>

        {/* 聊天内容 + 待办面板 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 待办进度 */}
          <div className="px-6 pt-4">
            <TodoPanel todos={todos} />
          </div>

          <div
            className="flex-1 overflow-y-auto p-6 space-y-4"
            ref={messagesEndRef}
          >
            {showWelcome && messages.length === 0 && (
              <WelcomeMessage />
            )}
            {visibleMessages.map((message) => (
              <React.Fragment key={message.id}>
                {message.hitlBlock && !message.content ? (
                  <HitlConfirmBlock request={message.hitlBlock} sessionId={currentSessionId} />
                ) : (
                  <>
                    <ChatMessage message={message} sessionId={currentSessionId} />
                    {message.hitlBlock && <HitlConfirmBlock request={message.hitlBlock} sessionId={currentSessionId} />}
                  </>
                )}
              </React.Fragment>
            ))}
            {ttsProgressLive && ttsProgressLive.total > 0 && (
              <div className="flex gap-4 justify-start">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="max-w-[80%] rounded-2xl px-4 py-3 shadow-sm bg-muted text-muted-foreground">
                  <span className="text-sm">TTS 进度：已生成 {ttsProgressLive.current} / {ttsProgressLive.total} 份文件</span>
                </div>
              </div>
            )}
            {pendingHitlRequest && (
              <HitlConfirmBlock
                request={pendingHitlRequest}
                sessionId={currentSessionId}
                onContinue={handleHitlContinue}
                onCancel={handleHitlCancel}
                onAddAllowlist={(actionType) => {
                  void handleAddAllowlist(actionType);
                }}
              />
            )}
            {isLoading && !waitingForConfirmation && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <div className="h-2 w-2 bg-current rounded-full animate-pulse" />
                <span>AI 正在思考...</span>
              </div>
            )}
            {waitingForConfirmation && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <span>等待您确认</span>
              </div>
            )}
          </div>

          {/* 等待 HITL 时仅在消息区 HitlConfirmBlock 内展示操作按钮（与 confirmText/cancelText 一致），避免与输入区上方重复 */}
          {showWelcome && messages.length === 0 && !waitingForConfirmation && (
            <div className="px-6 pb-2">
              <QuickOptions onOptionClick={handleQuickOptionClick} />
            </div>
          )}

          {/* 输入框 */}
          <div className="border-t border-border bg-card/50 p-4">
            <form onSubmit={handleSubmit} className="flex gap-3 items-end">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  waitingForConfirmation
                    ? '输入新消息并发送将取消当前确认并开始新对话'
                    : isLoading
                      ? '正在处理...'
                      : '输入消息...'
                }
                rows={1}
                className="min-h-[52px] max-h-[200px] resize-none overflow-y-auto rounded-xl border-border py-3 leading-normal"
                disabled={isLoading}
              />
              <Button
                type={waitingForConfirmation || !isLoading ? 'submit' : 'button'}
                variant={isLoading && !waitingForConfirmation ? 'destructive' : 'default'}
                onClick={isLoading && !waitingForConfirmation ? stopStream : handleSubmit}
                disabled={!waitingForConfirmation && !isLoading && !input.trim()}
                className="shrink-0 h-[52px] min-h-[52px] px-4 rounded-xl"
              >
                {isLoading && !waitingForConfirmation ? (
                  <>
                    <Square className="h-4 w-4" />
                    停止
                  </>
                ) : (
                  <>
                    <ArrowUp className="h-4 w-4" />
                    发送
                  </>
                )}
              </Button>
            </form>
          </div>

        </div>
                          {/* 工作区面板 */}
        {showWorkspace && <WorkspacePanel sessionId={currentSessionId} lastArtifactTime={lastArtifactTime} />}
      </div>

      <HitlModeDialog
        open={hitlModeOpen}
        onOpenChange={setHitlModeOpen}
        policy={hitlPolicy}
        loading={hitlPolicyLoading}
        onModeChange={handleSetHitlMode}
        onRemoveAllowlist={handleRemoveAllowlist}
        onClearAllowlist={handleClearAllowlist}
      />
    </div>
  );
}
