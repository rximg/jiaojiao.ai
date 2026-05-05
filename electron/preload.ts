/**
 * Preload API 定义与类型。实际被 Electron 加载的是 preload.cjs（CJS），
 * 因预加载脚本必须为 CommonJS。修改 API 时请同步更新 preload.cjs。
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

/** 单槽：避免多次 onConfirmRequest 叠加多个 ipcRenderer.on 监听 */
let hitlConfirmBridge: ((event: IpcRendererEvent, data: unknown) => void) | null = null;

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 配置相关
  config: {
    get: (caseId?: string) => ipcRenderer.invoke('config:get', caseId),
    getAiModels: () => ipcRenderer.invoke('config:getAiModels'),
    set: (config: any) => ipcRenderer.invoke('config:set', config),
    getWorkspaceDir: () => ipcRenderer.invoke('config:getWorkspaceDir'),
    getCases: () => ipcRenderer.invoke('config:getCases'),
    openConfigDir: () => ipcRenderer.invoke('config:openConfigDir'),
    showOutputPathDialog: (defaultPath?: string) => ipcRenderer.invoke('config:showOutputPathDialog', defaultPath),
    openFolder: (dirPath: string) => ipcRenderer.invoke('config:openFolder', dirPath),
  },
  // 同步 mp3 到 store（由工作区音频栏按钮触发）；sessionId 为空则同步全部，有值则只同步该 session
  sync: {
    syncAudioToStore: (sessionId?: string) => ipcRenderer.invoke('sync:audioToStore', sessionId),
  },
  // 存储相关
  storage: {
    getHistory: () => ipcRenderer.invoke('storage:getHistory'),
    saveHistory: (history: any) => ipcRenderer.invoke('storage:saveHistory', history),
    getBook: (id: string) => ipcRenderer.invoke('storage:getBook', id),
    saveBook: (book: any) => ipcRenderer.invoke('storage:saveBook', book),
  },
  // Agent 相关
  agent: {
    sendMessage: (message: string, sessionId?: string) =>
      ipcRenderer.invoke('agent:sendMessage', message, sessionId),
    onMessage: (callback: (data: any) => void) => {
      ipcRenderer.on('agent:message', (_event, data) => callback(data));
    },
    onToolCall: (callback: (data: { threadId: string; messageId?: string; toolCalls: import('../src/types/types').ToolCall[] }) => void) => {
      ipcRenderer.on('agent:toolCall', (_event, data) => callback(data));
    },
    onTtsProgress: (callback: (data: { threadId: string; messageId?: string; toolCallId?: string; current: number; total: number; path: string }) => void) => {
      ipcRenderer.on('agent:ttsProgress', (_event, data) => callback(data));
    },
    onBatchProgress: (callback: (data: { threadId: string; messageId?: string; toolCallId?: string; progress: import('../src/types/types').BatchProgress }) => void) => {
      ipcRenderer.on('agent:batchProgress', (_event, data) => callback(data));
    },
    onTodoUpdate: (callback: (data: any) => void) => {
      ipcRenderer.on('agent:todoUpdate', (_event, data) => callback(data));
    },
    onStepResult: (callback: (data: { threadId: string; messageId: string; stepResults: Array<{ type: 'image' | 'audio' | 'document'; payload: Record<string, unknown> }> }) => void) => {
      ipcRenderer.on('agent:stepResult', (_event, data) => callback(data));
    },
    onQuotaExceeded: (callback: (data: any) => void) => {
      ipcRenderer.on('agent:quotaExceeded', (_event, data) => callback(data));
    },
    onWorkspaceFileAdded: (callback: (data: { sessionId: string; category: string }) => void) => {
      ipcRenderer.on('agent:workspaceFileAdded', (_event, data) => callback(data));
    },
    stopStream: () => ipcRenderer.invoke('agent:stopStream'),
  },
  // HITL 人工确认（统一通道）
  hitl: {
    onConfirmRequest: (callback: (data: { requestId: string; actionType: string; payload: Record<string, unknown> }) => void) => {
      if (hitlConfirmBridge) {
        ipcRenderer.removeListener('hitl:confirmRequest', hitlConfirmBridge);
        hitlConfirmBridge = null;
      }
      hitlConfirmBridge = (_event, data) =>
        callback(data as { requestId: string; actionType: string; payload: Record<string, unknown> });
      ipcRenderer.on('hitl:confirmRequest', hitlConfirmBridge);
    },
    offConfirmRequest: () => {
      if (hitlConfirmBridge) {
        ipcRenderer.removeListener('hitl:confirmRequest', hitlConfirmBridge);
        hitlConfirmBridge = null;
      }
    },
    respond: (requestId: string, response: { approved: boolean; reason?: string; payload?: Record<string, unknown> }) =>
      ipcRenderer.invoke('hitl:respond', requestId, response),
    getPolicy: () => ipcRenderer.invoke('hitl:getPolicy'),
    setMode: (mode: 'auto' | 'allowlist' | 'strict') => ipcRenderer.invoke('hitl:setMode', mode),
    addAllowlist: (actionType: string) => ipcRenderer.invoke('hitl:addAllowlist', actionType),
    removeAllowlist: (actionType: string) => ipcRenderer.invoke('hitl:removeAllowlist', actionType),
    clearAllowlist: () => ipcRenderer.invoke('hitl:clearAllowlist'),
  },
  // 文件系统相关
  fs: {
    ls: (sessionId: string, relativePath?: string) =>
      ipcRenderer.invoke('fs:ls', sessionId, relativePath),
    readFile: (sessionId: string, relativePath: string) =>
      ipcRenderer.invoke('fs:readFile', sessionId, relativePath),
    getFilePath: (sessionId: string, relativePath: string) =>
      ipcRenderer.invoke('fs:getFilePath', sessionId, relativePath),
    glob: (sessionId: string, pattern?: string) =>
      ipcRenderer.invoke('fs:glob', sessionId, pattern),
    grep: (sessionId: string, pattern: string, globPattern?: string) =>
      ipcRenderer.invoke('fs:grep', sessionId, pattern, globPattern),
  },
  // 会话管理相关
  session: {
    create: (title?: string, prompt?: string, caseId?: string) =>
      ipcRenderer.invoke('session:create', title, prompt, caseId),
    list: () => ipcRenderer.invoke('session:list'),
    get: (sessionId: string) => ipcRenderer.invoke('session:get', sessionId),
    update: (sessionId: string, updates: any) =>
      ipcRenderer.invoke('session:update', sessionId, updates),
    delete: (sessionId: string) => ipcRenderer.invoke('session:delete', sessionId),
    closeRuntime: (sessionId: string) => ipcRenderer.invoke('session:closeRuntime', sessionId),
  },
});

// TypeScript 类型声明
declare global {
  interface Window {
    electronAPI: {
      config: {
        get: (caseId?: string) => Promise<any>;
        getAiModels: () => Promise<Record<string, { default: string; models: Array<{ id: string; label: string }> }>>;
        set: (config: any) => Promise<void>;
        getWorkspaceDir: () => Promise<string>;
        getCases: () => Promise<Array<{ id: string; title: string; description: string; cover: string | null; coverUrl?: string | null; order: number }>>;
        openConfigDir: () => Promise<void>;
        showOutputPathDialog: (defaultPath?: string) => Promise<string | null>;
        openFolder: (dirPath: string) => Promise<void>;
      };
      sync: {
        syncAudioToStore: (sessionId?: string) => Promise<{ success: boolean; copied: number; storeDir: string; files: string[]; message: string }>;
      };
      storage: {
        getHistory: () => Promise<any[]>;
        saveHistory: (history: any) => Promise<void>;
        getBook: (id: string) => Promise<any>;
        saveBook: (book: any) => Promise<void>;
      };
      agent: {
        sendMessage: (message: string, sessionId?: string) => Promise<string>;
        onMessage: (callback: (data: any) => void) => void;
        onToolCall: (callback: (data: { threadId: string; messageId?: string; toolCalls: import('../src/types/types').ToolCall[] }) => void) => void;
        onTtsProgress: (callback: (data: { threadId: string; messageId?: string; toolCallId?: string; current: number; total: number; path: string }) => void) => void;
        onBatchProgress: (callback: (data: { threadId: string; messageId?: string; toolCallId?: string; progress: import('../src/types/types').BatchProgress }) => void) => void;
        onTodoUpdate: (callback: (data: any) => void) => void;
        onStepResult: (callback: (data: { threadId: string; messageId: string; stepResults: Array<{ type: 'image' | 'audio' | 'document'; payload: Record<string, unknown> }> }) => void) => void;
        onQuotaExceeded: (callback: (data: any) => void) => void;
        onWorkspaceFileAdded: (callback: (data: { sessionId: string; category: string }) => void) => void;
        stopStream: () => Promise<void>;
      };
      hitl: {
        onConfirmRequest: (callback: (data: { requestId: string; actionType: string; payload: Record<string, unknown> }) => void) => void;
        offConfirmRequest: () => void;
        respond: (requestId: string, response: { approved: boolean; reason?: string; payload?: Record<string, unknown> }) => Promise<{ success: boolean }>;
        getPolicy: () => Promise<{ mode: 'auto' | 'allowlist' | 'strict'; allowlist: string[] }>;
        setMode: (mode: 'auto' | 'allowlist' | 'strict') => Promise<{ mode: 'auto' | 'allowlist' | 'strict'; allowlist: string[] }>;
        addAllowlist: (actionType: string) => Promise<{ mode: 'auto' | 'allowlist' | 'strict'; allowlist: string[] }>;
        removeAllowlist: (actionType: string) => Promise<{ mode: 'auto' | 'allowlist' | 'strict'; allowlist: string[] }>;
        clearAllowlist: () => Promise<{ mode: 'auto' | 'allowlist' | 'strict'; allowlist: string[] }>;
      };
      fs: {
        ls: (sessionId: string, relativePath?: string) => Promise<{ entries: any[] }>;
        readFile: (sessionId: string, relativePath: string) => Promise<{ content: string }>;
        getFilePath: (sessionId: string, relativePath: string) => Promise<{ path: string }>;
        glob: (sessionId: string, pattern?: string) => Promise<{ matches: string[] }>;
        grep: (sessionId: string, pattern: string, globPattern?: string) => Promise<{ matches: any[] }>;
      };
      session: {
        create: (title?: string, prompt?: string, caseId?: string) => Promise<{ sessionId: string; meta: any }>;
        list: () => Promise<{ sessions: any[] }>;
        get: (sessionId: string) => Promise<{ meta: any; messages: any[]; todos: any[]; files: any }>;
        update: (sessionId: string, updates: any) => Promise<{ meta: any }>;
        delete: (sessionId: string) => Promise<{ success: boolean }>;
        closeRuntime: (sessionId: string) => Promise<{ success: boolean }>;
      };
    };
  }
}
