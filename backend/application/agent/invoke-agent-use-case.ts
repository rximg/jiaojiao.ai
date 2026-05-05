/**
 * 调用 Agent 用例：创建 Agent、加载历史、流式执行并通过回调推送消息/步骤/工具调用/todos
 * 不依赖 Electron，由 IPC 注入 createAgent、getSessionMessages 与 callbacks
 */
import { runWithContextAsync, setCurrentRunContext, type RunContext } from './run-context.js';

export type StepResult =
  | { type: 'image'; payload: { path: string; prompt?: string } }
  | { type: 'audio'; payload: { path: string; text?: string } }
  | { type: 'document'; payload: { pathOrContent: string; title?: string } };

export interface InvokeAgentUseCaseCallbacks {
  onMessage: (threadId: string, messages: Array<{ id: string; role: string; content: string; stepResults?: StepResult[] }>) => void;
  onStepResult?: (threadId: string, messageId: string, stepResults: StepResult[]) => void;
  onToolCall?: (threadId: string, messageId: string | undefined, toolCalls: any[]) => void;
  /** LLM usage：真实 completion tokens（来自上游 usage），可能流式或仅结束时一次 */
  onTokenUsage?: (threadId: string, messageId: string | undefined, completionTokens: number, isFinal?: boolean) => void;
  /** TTS 每完成一个文件时推送，用于前端显示「已生成 x/n 份文件」 */
  onTtsProgress?: (threadId: string, messageId: string | undefined, toolCallId: string | undefined, current: number, total: number, path: string) => void;
  /** 统一批量进度回调，覆盖所有批量工具（generate_images, edit_images, generate_audio 等） */
  onBatchProgress?: (threadId: string, messageId: string | undefined, toolCallId: string | undefined, progress: import('../../tools/types.js').BatchProgress) => void;
  onTodoUpdate?: (threadId: string, todos: any[]) => void;
}

export interface InvokeAgentUseCaseDeps {
  createAgent: (sessionId?: string) => Promise<any>;
  getSessionMessages: (sessionId: string) => Promise<any[]>;
  /** 可选：解析步骤结果中的相对路径为绝对路径 */
  resolveStepResultPaths?: (sessionId: string | undefined, stepResults: StepResult[]) => Promise<StepResult[]>;
}

export interface InvokeAgentUseCaseParams {
  message: string;
  sessionId?: string;
  signal: AbortSignal;
  callbacks: InvokeAgentUseCaseCallbacks;
}

const MAX_HISTORY = 30;

function fixToolCallsInMessages(messages: any[]): any[] {
  return messages.map((msg) => {
    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      msg.tool_calls = msg.tool_calls.map((toolCall: any, index: number) => {
        if (!toolCall.id) {
          toolCall.id = `call_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 9)}`;
        }
        return toolCall;
      });
    }
    if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
      msg.toolCalls = msg.toolCalls.map((toolCall: any, index: number) => {
        if (!toolCall.id) {
          toolCall.id = `call_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 9)}`;
        }
        return toolCall;
      });
    }
    return msg;
  });
}

function normalizeMessageRole(msg: any): string | undefined {
  if (!msg || typeof msg !== 'object') return undefined;

  if (typeof msg.role === 'string' && msg.role.length > 0) {
    return msg.role;
  }

  const rawType =
    typeof msg._getType === 'function'
      ? msg._getType()
      : typeof msg.getType === 'function'
        ? msg.getType()
        : typeof msg.type === 'string'
          ? msg.type
          : undefined;

  if (typeof rawType !== 'string' || rawType.length === 0) {
    return undefined;
  }

  switch (rawType) {
    case 'ai':
      return 'assistant';
    case 'human':
      return 'user';
    case 'system':
      return 'system';
    default:
      return rawType;
  }
}

function extractStepResultsFromContent(content: string): StepResult[] {
  if (!content || typeof content !== 'string') return [];
  const results: StepResult[] = [];
  const imagePatterns = [
    /(?:图片[：:]\s*)([^\s\n]+\.(?:png|jpg|jpeg))/gi,
    /(?:outputs[/\\]workspaces[/\\][^/\\]+[/\\]images[/\\][^\s\n]+\.(?:png|jpg|jpeg))/gi,
    /(?:images[/\\][^\s\n]+\.(?:png|jpg|jpeg))/gi,
    /([A-Za-z]:[\\/][^\s\n]+\.(?:png|jpg|jpeg))/g,
    // POSIX 绝对路径：至少包含一层目录，避免把 "/foo.png" 这种“前导斜杠的相对路径”误当成根目录文件
    /(\/[^/\s\n]+\/[^\s\n]+\.(?:png|jpg|jpeg))/g,
  ];
  const seenImages = new Set<string>();
  for (const re of imagePatterns) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(content)) !== null) {
      const p = (m[1] ?? m[0]).replace(/^图片[：:]\s*/i, '').trim();
      if (p && !seenImages.has(p)) {
        seenImages.add(p);
        results.push({ type: 'image', payload: { path: p } });
      }
    }
  }
  const audioPatterns = [
    /(?:音频[：:]\s*)([^\s\n]+\.(?:mp3|wav))/gi,
    /(?:outputs[/\\]workspaces[/\\][^/\\]+[/\\]audio[/\\][^\s\n]+\.(?:mp3|wav))/gi,
    /(?:audio[/\\][^\s\n]+\.(?:mp3|wav))/gi,
    /([A-Za-z]:[\\/][^\s\n]+\.(?:mp3|wav))/g,
    // 同上：POSIX 绝对路径至少一层目录
    /(\/[^/\s\n]+\/[^\s\n]+\.(?:mp3|wav))/g,
  ];
  const seenAudio = new Set<string>();
  for (const re of audioPatterns) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(content)) !== null) {
      const p = (m[1] ?? m[0]).replace(/^音频[：:]\s*/i, '').trim();
      if (p && !seenAudio.has(p)) {
        seenAudio.add(p);
        results.push({ type: 'audio', payload: { path: p } });
      }
    }
  }
  return results;
}

function isStoryPlanReviewPayload(content: string): boolean {
  if (!content || typeof content !== 'string') return false;

  try {
    const parsed = JSON.parse(content) as {
      filePath?: unknown;
      title?: unknown;
      markdownContent?: unknown;
      reviewStage?: unknown;
    };

    return (
      typeof parsed.filePath === 'string' &&
      parsed.filePath.trim().toLowerCase().endsWith('.md') &&
      typeof parsed.markdownContent === 'string' &&
      parsed.markdownContent.trim().length > 0 &&
      parsed.markdownContent.includes('#') &&
      typeof parsed.reviewStage === 'string' &&
      parsed.reviewStage === 'story_plan' &&
      (typeof parsed.title === 'undefined' || typeof parsed.title === 'string')
    );
  } catch {
    return false;
  }
}

function shouldEmitAssistantMessage(content: string, stepResults: StepResult[]): boolean {
  if (isStoryPlanReviewPayload(content)) {
    return false;
  }
  return content.trim().length > 0 || stepResults.length > 0;
}

function normalizeStepResultKey(sr: StepResult): string {
  const raw =
    sr.type === 'document'
      ? sr.payload.pathOrContent
      : sr.type === 'image'
        ? sr.payload.path
        : sr.payload.path;
  return `${sr.type}:${String(raw ?? '')
    .trim()
    .replace(/^local-file:\/\//, '')
    .replace(/\\/g, '/')
    .toLowerCase()}`;
}

function dedupeStepResults(stepResults: StepResult[]): StepResult[] {
  const seen = new Set<string>();
  const out: StepResult[] = [];
  for (const sr of stepResults) {
    const k = normalizeStepResultKey(sr);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(sr);
  }
  return out;
}

/**
 * 执行流式调用。成功返回 sessionId，用户中止返回 'stream-aborted'。
 */
export async function invokeAgentUseCase(
  deps: InvokeAgentUseCaseDeps,
  params: InvokeAgentUseCaseParams
): Promise<string> {
  const { createAgent, getSessionMessages, resolveStepResultPaths } = deps;
  const { message, sessionId, signal, callbacks } = params;

  const agent = await createAgent(sessionId);
  // 统一使用 sessionId 作为 thread_id，如果没有则生成临时 ID
  const effectiveSessionId = sessionId ?? `session-${Date.now()}`;

  let inputMessages: any[];
  if (sessionId) {
    const history = await getSessionMessages(sessionId);
    const recent = history.slice(-MAX_HISTORY);
    const historyForAgent = recent.map((m: any) => ({
      role: m.role || 'user',
      content: typeof m.content === 'string' ? m.content : (m.content ?? ''),
    }));
    const isReopenedSession = recent.length > 0;
    const userContent = isReopenedSession
      ? `【当前为已有会话的继续；请结合对话历史和 checkpoint 中的 todo 状态，仅执行用户在本条消息中要求的步骤（如「重新生成台词」则只做第 3 步，勿从头重跑）。】\n\n${message}`
      : message;
    inputMessages = [...historyForAgent, { role: 'user', content: userContent }];
  } else {
    inputMessages = [{ role: 'user', content: message }];
  }
  const fixedMessages = fixToolCallsInMessages(inputMessages);

  const runConfig: { signal: AbortSignal; recursionLimit: number; configurable?: { thread_id: string } } = {
    signal,
    recursionLimit: 200,
  };
  if (sessionId) runConfig.configurable = { thread_id: sessionId };

  const stream = await (agent as any).stream({ messages: fixedMessages }, runConfig);

  const runCtx: RunContext = {
    threadId: effectiveSessionId,
    onTokenUsage: callbacks.onTokenUsage,
    onTtsProgress: callbacks.onTtsProgress,
    onBatchProgress: callbacks.onBatchProgress,
  };

  setCurrentRunContext(runCtx);
  try {
  return await runWithContextAsync(runCtx, async () => {
  let latestAssistantMessageId: string | null = null;
  for await (const chunk of stream) {
    if (signal.aborted) break;

    const chunkKeys = Object.keys(chunk);
    const nodeKey = chunkKeys[0];
    // IMPORTANT FIX: If streamMode is 'values' by default, chunk IS the state.
    // In 'values', keys might be ['messages', 'todos']. If we do chunk[nodeKey], we get the messages array, not the state dict!
    // But if streamMode is 'updates', chunk is { [nodeName]: state }, so keys might be ['model_request'].
    // We should safely detect if it's an update chunk or value chunk.
    const isUpdateChunk = typeof chunk === 'object' && chunkKeys.length === 1 && typeof (chunk as any)[nodeKey] === 'object' && !Array.isArray((chunk as any)[nodeKey]);
    
    const state = isUpdateChunk ? (chunk as any)[nodeKey] : chunk;

    if (state?.messages && Array.isArray(state.messages)) {
      const fixedStateMessages = fixToolCallsInMessages(state.messages);
      const newMessages = fixedStateMessages
        .filter((msg: any) => normalizeMessageRole(msg) === 'assistant')
        .slice(-1);
      if (newMessages.length > 0) {
        const msg = newMessages[0];
        const role = normalizeMessageRole(msg) ?? 'assistant';
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
        let stepResults = extractStepResultsFromContent(content);
        if (resolveStepResultPaths && stepResults.length > 0) {
          stepResults = await resolveStepResultPaths(sessionId, stepResults);
        }
        if (stepResults.length > 0) {
          stepResults = dedupeStepResults(stepResults);
        }
        // 不向 UI 推送某些 assistant 片段（如空内容轮次、策划稿 JSON），但不得 skip 本 chunk 后续的
        // onToolCall / onTodoUpdate，否则同一 state 里的 todos 更新会被 continue 吞掉。
        if (shouldEmitAssistantMessage(content, stepResults)) {
          const messageIdFromChunk = typeof msg.id === 'string' && msg.id.length > 0 ? msg.id : null;
          const stableId: string = messageIdFromChunk ?? latestAssistantMessageId ?? `stream-${effectiveSessionId}`;
          // 同一条 assistant 消息的流式增量应复用同一个 ID；
          // 但同一轮 run 中出现新的 assistant 消息时，必须切换到新的消息 ID，避免前端按 ID 去重时把后一条覆盖前一条。
          latestAssistantMessageId = stableId;
          // 同步更新 runCtx.messageId，确保工具执行期间（batch/tts 等）pushProgress 引用正确的消息 ID
          // LangGraph stream 的 state 顶层不含 tool_calls，此处是唯一可靠的更新时机
          runCtx.messageId = stableId;
          const mapped = [
            {
              id: stableId,
              role,
              content,
              ...(stepResults.length > 0 ? { stepResults } : {}),
            },
          ];
          callbacks.onMessage(effectiveSessionId, mapped);
          if (stepResults.length > 0 && callbacks.onStepResult) {
            callbacks.onStepResult(effectiveSessionId, stableId, stepResults);
          }
        }
      }
    }

    if (state?.tool_calls || state?.toolCalls) {
      const toolCallsRaw = state.tool_calls ?? state.toolCalls;
      const toolCalls = Array.isArray(toolCallsRaw) ? toolCallsRaw : [toolCallsRaw];
      runCtx.messageId = latestAssistantMessageId ?? undefined;
      const ttsCall = toolCalls.find((tc: any) => tc.name === 'batch_tool_call' || tc.name === 'generate_audio');
      runCtx.toolCallId = ttsCall?.id ?? toolCalls[0]?.id;
      if (callbacks.onToolCall) {
        callbacks.onToolCall(effectiveSessionId, runCtx.messageId, toolCalls);
      }
    }

    if (state?.todos && Array.isArray(state.todos) && state.todos.length > 0 && callbacks.onTodoUpdate) {
      callbacks.onTodoUpdate(effectiveSessionId, state.todos);
    }
  }

  return effectiveSessionId;
  });
  } finally {
    setCurrentRunContext(null);
  }
}
