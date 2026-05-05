const { contextBridge, ipcRenderer } = require('electron');

/** 单槽：避免多次 onConfirmRequest 叠加多个 ipcRenderer.on 监听（与 preload.ts 一致） */
let hitlConfirmBridge = null;
/** 单槽：避免重复注册导致的多次回调（与 React effect 频繁重跑兼容） */
let agentMessageBridge = null;
let agentToolCallBridge = null;
let agentTokenUsageBridge = null;
let agentTtsProgressBridge = null;
let agentBatchProgressBridge = null;
let agentTodoUpdateBridge = null;
let agentStepResultBridge = null;
let agentQuotaExceededBridge = null;
let agentWorkspaceFileAddedBridge = null;

// 暴露安全的 API 给渲染进程（与 preload.ts 保持一致，Electron 预加载必须用 CJS）
contextBridge.exposeInMainWorld('electronAPI', {
  config: {
    get: (caseId) => ipcRenderer.invoke('config:get', caseId),
    getAiModels: () => ipcRenderer.invoke('config:getAiModels'),
    set: (config) => ipcRenderer.invoke('config:set', config),
    getWorkspaceDir: () => ipcRenderer.invoke('config:getWorkspaceDir'),
    getCases: () => ipcRenderer.invoke('config:getCases'),
    openConfigDir: () => ipcRenderer.invoke('config:openConfigDir'),
    showOutputPathDialog: (defaultPath) => ipcRenderer.invoke('config:showOutputPathDialog', defaultPath),
    openFolder: (dirPath) => ipcRenderer.invoke('config:openFolder', dirPath),
  },
  sync: {
    syncAudioToStore: (sessionId) => ipcRenderer.invoke('sync:audioToStore', sessionId),
  },
  storage: {
    getHistory: () => ipcRenderer.invoke('storage:getHistory'),
    saveHistory: (history) => ipcRenderer.invoke('storage:saveHistory', history),
    getBook: (id) => ipcRenderer.invoke('storage:getBook', id),
    saveBook: (book) => ipcRenderer.invoke('storage:saveBook', book),
  },
  agent: {
    sendMessage: (message, sessionId) =>
      ipcRenderer.invoke('agent:sendMessage', message, sessionId),
    onMessage: (callback) => {
      if (agentMessageBridge) {
        ipcRenderer.removeListener('agent:message', agentMessageBridge);
        agentMessageBridge = null;
      }
      agentMessageBridge = (_event, data) => callback(data);
      ipcRenderer.on('agent:message', agentMessageBridge);
    },
    onToolCall: (callback) => {
      if (agentToolCallBridge) {
        ipcRenderer.removeListener('agent:toolCall', agentToolCallBridge);
        agentToolCallBridge = null;
      }
      agentToolCallBridge = (_event, data) => callback(data);
      ipcRenderer.on('agent:toolCall', agentToolCallBridge);
    },
    onTokenUsage: (callback) => {
      if (agentTokenUsageBridge) {
        ipcRenderer.removeListener('agent:tokenUsage', agentTokenUsageBridge);
        agentTokenUsageBridge = null;
      }
      agentTokenUsageBridge = (_event, data) => callback(data);
      ipcRenderer.on('agent:tokenUsage', agentTokenUsageBridge);
    },
    onTtsProgress: (callback) => {
      if (agentTtsProgressBridge) {
        ipcRenderer.removeListener('agent:ttsProgress', agentTtsProgressBridge);
        agentTtsProgressBridge = null;
      }
      agentTtsProgressBridge = (_event, data) => callback(data);
      ipcRenderer.on('agent:ttsProgress', agentTtsProgressBridge);
    },
    onBatchProgress: (callback) => {
      if (agentBatchProgressBridge) {
        ipcRenderer.removeListener('agent:batchProgress', agentBatchProgressBridge);
        agentBatchProgressBridge = null;
      }
      agentBatchProgressBridge = (_event, data) => callback(data);
      ipcRenderer.on('agent:batchProgress', agentBatchProgressBridge);
    },
    onTodoUpdate: (callback) => {
      if (agentTodoUpdateBridge) {
        ipcRenderer.removeListener('agent:todoUpdate', agentTodoUpdateBridge);
        agentTodoUpdateBridge = null;
      }
      agentTodoUpdateBridge = (_event, data) => callback(data);
      ipcRenderer.on('agent:todoUpdate', agentTodoUpdateBridge);
    },
    onStepResult: (callback) => {
      if (agentStepResultBridge) {
        ipcRenderer.removeListener('agent:stepResult', agentStepResultBridge);
        agentStepResultBridge = null;
      }
      agentStepResultBridge = (_event, data) => callback(data);
      ipcRenderer.on('agent:stepResult', agentStepResultBridge);
    },
    onQuotaExceeded: (callback) => {
      if (agentQuotaExceededBridge) {
        ipcRenderer.removeListener('agent:quotaExceeded', agentQuotaExceededBridge);
        agentQuotaExceededBridge = null;
      }
      agentQuotaExceededBridge = (_event, data) => callback(data);
      ipcRenderer.on('agent:quotaExceeded', agentQuotaExceededBridge);
    },
    onWorkspaceFileAdded: (callback) => {
      if (agentWorkspaceFileAddedBridge) {
        ipcRenderer.removeListener('agent:workspaceFileAdded', agentWorkspaceFileAddedBridge);
        agentWorkspaceFileAddedBridge = null;
      }
      agentWorkspaceFileAddedBridge = (_event, data) => callback(data);
      ipcRenderer.on('agent:workspaceFileAdded', agentWorkspaceFileAddedBridge);
    },
    stopStream: () => ipcRenderer.invoke('agent:stopStream'),
  },
  hitl: {
    onConfirmRequest: (callback) => {
      if (hitlConfirmBridge) {
        ipcRenderer.removeListener('hitl:confirmRequest', hitlConfirmBridge);
        hitlConfirmBridge = null;
      }
      hitlConfirmBridge = (_event, data) => callback(data);
      ipcRenderer.on('hitl:confirmRequest', hitlConfirmBridge);
    },
    offConfirmRequest: () => {
      if (hitlConfirmBridge) {
        ipcRenderer.removeListener('hitl:confirmRequest', hitlConfirmBridge);
        hitlConfirmBridge = null;
      }
    },
    respond: (requestId, response) =>
      ipcRenderer.invoke('hitl:respond', requestId, response),
    getPolicy: () => ipcRenderer.invoke('hitl:getPolicy'),
    setMode: (mode) => ipcRenderer.invoke('hitl:setMode', mode),
    addAllowlist: (actionType) => ipcRenderer.invoke('hitl:addAllowlist', actionType),
    removeAllowlist: (actionType) => ipcRenderer.invoke('hitl:removeAllowlist', actionType),
    clearAllowlist: () => ipcRenderer.invoke('hitl:clearAllowlist'),
  },
  fs: {
    ls: (sessionId, relativePath) =>
      ipcRenderer.invoke('fs:ls', sessionId, relativePath),
    readFile: (sessionId, relativePath) =>
      ipcRenderer.invoke('fs:readFile', sessionId, relativePath),
    getFilePath: (sessionId, relativePath) =>
      ipcRenderer.invoke('fs:getFilePath', sessionId, relativePath),
    glob: (sessionId, pattern) =>
      ipcRenderer.invoke('fs:glob', sessionId, pattern),
    grep: (sessionId, pattern, globPattern) =>
      ipcRenderer.invoke('fs:grep', sessionId, pattern, globPattern),
  },
  session: {
    create: (title, prompt, caseId) =>
      ipcRenderer.invoke('session:create', title, prompt, caseId),
    list: () => ipcRenderer.invoke('session:list'),
    get: (sessionId) => ipcRenderer.invoke('session:get', sessionId),
    update: (sessionId, updates) =>
      ipcRenderer.invoke('session:update', sessionId, updates),
    delete: (sessionId) => ipcRenderer.invoke('session:delete', sessionId),
    closeRuntime: (sessionId) => ipcRenderer.invoke('session:closeRuntime', sessionId),
  },
});
