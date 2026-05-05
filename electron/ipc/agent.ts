import { ipcMain, BrowserWindow, type WebContents } from 'electron';
import { getBackendConfigDir } from './config.js';
import { workspaceNotifier } from '../../backend/services/workspace-notifier.js';
import { getCachedSessionCaseId, getSessionMessages } from './session.js';
import { invokeAgentUseCase } from '../../backend/application/agent/index.js';
import { resolveStepResultPaths } from '../../backend/application/helpers/resolve-step-result-paths.js';

let currentStreamController: AbortController | null = null;

/** 向渲染进程发送额度/限流错误并抛出。403=额度或权限，429=请求频率超限（限流）。 */
function sendQuotaExceededAndThrow(
  win: WebContents,
  error: any,
  kind: '403' | '429'
): never {
  const is429 = kind === '429';
  const message = is429
    ? '请求过于频繁，请稍后再试'
    : 'API额度已用完，请前往设置更换模型';
  const details = is429
    ? '当前接口调用频率超限（429），请降低请求频率或稍后重试。详见：https://help.aliyun.com/zh/model-studio/error-code#rate-limit'
    : undefined;
  win.send('agent:quotaExceeded', {
    kind: is429 ? 'rate_limit' : 'quota',
    message,
    error: error?.message ?? (is429 ? '429 Too Many Requests' : '403 Forbidden'),
    ...(details ? { details } : {}),
  });
  throw new Error(message);
}

/** 判断是否为用户取消 HITL 导致的错误 */
function isCancelledByUser(error: any): boolean {
  const messages: string[] = [];
  let cursor: any = error;
  let depth = 0;

  while (cursor && depth < 5) {
    if (typeof cursor.message === 'string') {
      messages.push(cursor.message.toLowerCase());
    }
    cursor = cursor.cause;
    depth += 1;
  }

  return messages.some(
    (msg) =>
      msg.includes('cancelled by user') ||
      msg.includes('rejected or cancelled')
  );
}

/** 判断是否为额度/配额类错误（403 或 429） */
function isQuotaError(error: any): '403' | '429' | null {
  if (error?.message?.includes('403') || error?.status === 403 || error?.code === 403)
    return '403';
  if (
    error?.name === 'InsufficientQuotaError' ||
    error?.message?.includes('429') ||
    error?.message?.includes('quota') ||
    error?.status === 429 ||
    error?.code === 429
  )
    return '429';
  return null;
}

/**
 * 发送用户消息给 Agent 并流式返回结果。委托 InvokeAgentUseCase，IPC 仅负责 env、callbacks、错误与取消处理。
 * @returns 成功时返回 sessionId；用户中止时返回 'stream-aborted'
 */
async function sendAgentMessage(
  message: string,
  sessionId?: string
): Promise<string> {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (!mainWindow) throw new Error('Main window not found');

  const previousSessionId = process.env.AGENT_SESSION_ID;
  const previousCaseId = process.env.AGENT_CASE_ID;
  try {
    currentStreamController = new AbortController();
    if (sessionId) {
      process.env.AGENT_SESSION_ID = sessionId;
      console.log(`[agent] Set AGENT_SESSION_ID to: ${sessionId}`);
    }

    const cachedCaseId = sessionId ? getCachedSessionCaseId(sessionId) : undefined;
    if (typeof cachedCaseId === 'string' && cachedCaseId.trim().length > 0) {
      process.env.AGENT_CASE_ID = cachedCaseId.trim();
      console.log(`[agent] Set AGENT_CASE_ID to: ${process.env.AGENT_CASE_ID}`);
    } else {
      delete process.env.AGENT_CASE_ID;
    }

    process.env.AGENT_CONFIG_DIR = getBackendConfigDir();

    const { createMainAgent } = await import('../../backend/agent/AgentFactory.js');
    const deps = {
      createAgent: createMainAgent,
      getSessionMessages,
      resolveStepResultPaths: (sid: string | undefined, steps: any[]) => resolveStepResultPaths(sid, steps),
    };
    const callbacks = {
      onMessage: (newThreadId: string, messages: any[]) => {
        mainWindow.webContents.send('agent:message', { threadId: newThreadId, messages });
      },
      onTokenUsage: (
        newThreadId: string,
        messageId: string | undefined,
        completionTokens: number,
        isFinal?: boolean
      ) => {
        mainWindow.webContents.send('agent:tokenUsage', {
          threadId: newThreadId,
          messageId,
          completionTokens,
          ...(typeof isFinal === 'boolean' ? { isFinal } : {}),
        });
      },
      onStepResult: (newThreadId: string, messageId: string, stepResults: any[]) => {
        mainWindow.webContents.send('agent:stepResult', { threadId: newThreadId, messageId, stepResults });
      },
      onToolCall: (newThreadId: string, messageId: string | undefined, toolCalls: any[]) => {
        mainWindow.webContents.send('agent:toolCall', { threadId: newThreadId, messageId, toolCalls });
      },
      onTtsProgress: (newThreadId: string, messageId: string | undefined, toolCallId: string | undefined, current: number, total: number, path: string) => {
        mainWindow.webContents.send('agent:ttsProgress', { threadId: newThreadId, messageId, toolCallId, current, total, path });
      },
      onBatchProgress: (newThreadId: string, messageId: string | undefined, toolCallId: string | undefined, progress: any) => {
        mainWindow.webContents.send('agent:batchProgress', { threadId: newThreadId, messageId, toolCallId, progress });
      },
      onTodoUpdate: (newThreadId: string, todos: any[]) => {
        mainWindow.webContents.send('agent:todoUpdate', { threadId: newThreadId, todos });
      },
    };

    try {
      const returnedSessionId = await invokeAgentUseCase(deps, {
        message,
        sessionId,
        signal: currentStreamController.signal,
        callbacks,
      });
      return returnedSessionId;
    } catch (streamError: any) {
      if (streamError.name === 'AbortError') return 'stream-aborted';
      console.error('Stream error:', streamError);

      const quotaKind = isQuotaError(streamError);
      if (quotaKind)
        sendQuotaExceededAndThrow(mainWindow.webContents, streamError, quotaKind);

      if (isCancelledByUser(streamError)) {
        const resultSessionId = sessionId ?? `session-${Date.now()}`;
        mainWindow.webContents.send('agent:streamEnd', {
          threadId: resultSessionId,
          cancelled: true,
        });
        return resultSessionId;
      }
      throw streamError;
    }
  } catch (error: any) {
    if (error.name === 'AbortError') return 'stream-aborted';

    const quotaKind = isQuotaError(error);
    if (quotaKind)
      sendQuotaExceededAndThrow(mainWindow.webContents, error, quotaKind);

    console.error('Agent error:', error);
    throw error;
  } finally {
    if (previousSessionId !== undefined) {
      process.env.AGENT_SESSION_ID = previousSessionId;
    } else {
      delete process.env.AGENT_SESSION_ID;
    }

    if (previousCaseId !== undefined) {
      process.env.AGENT_CASE_ID = previousCaseId;
    } else {
      delete process.env.AGENT_CASE_ID;
    }
  }
}

export function handleAgentIPC() {
  workspaceNotifier.on('fileAdded', (data: { sessionId: string; category: string }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w?.webContents?.send('agent:workspaceFileAdded', data);
  });

  ipcMain.handle(
    'agent:sendMessage',
    async (_event, message: string, sessionId?: string) => {
      return sendAgentMessage(message, sessionId);
    }
  );

  ipcMain.handle('agent:stopStream', async () => {
    if (currentStreamController) {
      currentStreamController.abort();
      currentStreamController = null;
    }
  });
}
