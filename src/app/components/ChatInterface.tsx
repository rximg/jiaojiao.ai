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
import { isRenderableMessage, shouldSuppressAssistantPlanMessage } from '../../lib/chat-messages';
import { isHitlPending } from '../../lib/hitl-block';

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
  const {
    messages,
    todos,
    isLoading,
    thinkingTokensLive,
    sendMessage,
    stopStream,
    currentSessionId,
    createNewSession,
    loadSession,
    resetSession,
    lastArtifactTime,
    pendingHitlRequest,
    respondConfirm,
    updateHitlDraftEdits,
    rejectStaleHitl,
    ttsProgressLive,
  } = useChat();
  const visibleMessages = messages.filter((message, idx) => {
    if (message.role === 'assistant' && shouldSuppressAssistantPlanMessage(messages, idx)) {
      return false;
    }
    return message.role !== 'assistant' || isRenderableMessage(message);
  });
  const waitingForLiveHitl = Boolean(pendingHitlRequest);
  const hasStaleHitl = messages.some((m) => m.hitlBlock && isHitlPending(m.hitlBlock));
  const hasRenderableAssistantYet = messages.some((m) => m.role === 'assistant' && m.content.trim().length > 0);
  const [showWelcome, setShowWelcome] = useState(true);
  const [showWorkspace] = useState(true);
  const [hitlModeOpen, setHitlModeOpen] = useState(false);
  const [hitlPolicy, setHitlPolicy] = useState<HitlPolicy>({ mode: 'strict', allowlist: [] });
  const [hitlPolicyLoading, setHitlPolicyLoading] = useState(false);
  const [hitlUserHint, setHitlUserHint] = useState<string | null>(null);
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
      // Live HITL：须先处理确认块，禁止用发消息隐式取消（Stale 无 pendingHitlRequest，仍可发消息）
      if (pendingHitlRequest) {
        if (messageText) {
          console.warn('[ChatInterface] 请先完成上方人工确认后再发送消息');
        }
        return;
      }
      setHitlUserHint(null);
      if (!messageText || isLoading) return;
      const sessionId = await ensureSessionForSend();
      if (!sessionId) return;
      setShowWelcome(false);
      await sendMessage(messageText, sessionId);
      setInput('');
      if (textareaRef.current) textareaRef.current.focus();
    },
    [ensureSessionForSend, input, isLoading, pendingHitlRequest, sendMessage]
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

  const renderHitlBlock = useCallback(
    (message: import('../../types/types').Message) => {
      const hb = message.hitlBlock!;
      const isLive = Boolean(pendingHitlRequest?.requestId === hb.requestId);
      return (
        <HitlConfirmBlock
          request={hb}
          sessionId={currentSessionId}
          isLive={isLive}
          onDraftEditsChange={(d) => updateHitlDraftEdits(message.id, d)}
          onContinue={(editedPayload) => {
            if (pendingHitlRequest?.requestId === hb.requestId) {
              void respondConfirm(hb.requestId, true, editedPayload);
              return;
            }
            if (isHitlPending(hb)) {
              setHitlUserHint(
                '无法从离线状态自动继续。请在下方输入框发送「继续上一步确认」，由 checkpoint 恢复该步。'
              );
            }
          }}
          onCancel={() => {
            if (pendingHitlRequest?.requestId === hb.requestId) {
              void respondConfirm(hb.requestId, false);
            } else if (isHitlPending(hb)) {
              rejectStaleHitl(message.id);
            }
          }}
          onAddAllowlist={(actionType) => {
            void handleAddAllowlist(actionType);
          }}
        />
      );
    },
    [
      currentSessionId,
      pendingHitlRequest,
      respondConfirm,
      updateHitlDraftEdits,
      rejectStaleHitl,
      handleAddAllowlist,
    ]
  );

  return (
    <div className="flex h-screen flex-col">
      {/* 配置栏 */}
      <header className="flex h-16 items-center justify-between border-b border-border bg-card/80 px-6 shadow-sm">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBackClick}
            disabled={isLoading && !waitingForLiveHitl}
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
                  renderHitlBlock(message)
                ) : (
                  <>
                    <ChatMessage message={message} sessionId={currentSessionId} />
                    {message.hitlBlock && renderHitlBlock(message)}
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
            {isLoading && !waitingForLiveHitl && !hasRenderableAssistantYet && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <div className="h-2 w-2 bg-current rounded-full animate-pulse" />
                <span>AI 正在思考…</span>
                <span className="opacity-70">
                  completion tokens: {thinkingTokensLive ? thinkingTokensLive.completionTokens : '—'}
                </span>
              </div>
            )}
            {waitingForLiveHitl && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <span>等待您确认</span>
              </div>
            )}
          </div>

          {/* 等待 HITL 时仅在消息区 HitlConfirmBlock 内展示操作按钮（与 confirmText/cancelText 一致），避免与输入区上方重复 */}
          {showWelcome && messages.length === 0 && !waitingForLiveHitl && (
            <div className="px-6 pb-2">
              <QuickOptions onOptionClick={handleQuickOptionClick} />
            </div>
          )}

          {/* 输入框 */}
          <div className="border-t border-border bg-card/50 p-4">
            {hitlUserHint && (
              <p className="mb-2 text-sm text-amber-800 dark:text-amber-200 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
                {hitlUserHint}
              </p>
            )}
            <form onSubmit={handleSubmit} className="flex gap-3 items-end">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  waitingForLiveHitl
                    ? '请先完成上方人工确认（或点击「暂不执行本次」）'
                    : hasStaleHitl
                      ? '可发送「继续上一步确认」以从 checkpoint 恢复待确认步骤'
                      : isLoading
                        ? '正在处理...'
                        : '输入消息...'
                }
                rows={1}
                className="min-h-[52px] max-h-[200px] resize-none overflow-y-auto rounded-xl border-border py-3 leading-normal"
                disabled={isLoading || waitingForLiveHitl}
              />
              <Button
                type={waitingForLiveHitl || !isLoading ? 'submit' : 'button'}
                variant={isLoading && !waitingForLiveHitl ? 'destructive' : 'default'}
                onClick={isLoading && !waitingForLiveHitl ? stopStream : handleSubmit}
                disabled={
                  waitingForLiveHitl || (!isLoading && !input.trim())
                }
                className="shrink-0 h-[52px] min-h-[52px] px-4 rounded-xl"
              >
                {isLoading && !waitingForLiveHitl ? (
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
