const { contextBridge, ipcRenderer } = require('electron');

/** 单槽：避免多次 onConfirmRequest 叠加多个 ipcRenderer.on 监听（与 preload.ts 一致） */
let hitlConfirmBridge = null;

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
      ipcRenderer.on('agent:message', (_event, data) => callback(data));
    },
    onToolCall: (callback) => {
      ipcRenderer.on('agent:toolCall', (_event, data) => callback(data));
    },
    onTokenUsage: (callback) => {
      ipcRenderer.on('agent:tokenUsage', (_event, data) => callback(data));
    },
    onTtsProgress: (callback) => {
      ipcRenderer.on('agent:ttsProgress', (_event, data) => callback(data));
    },
    onBatchProgress: (callback) => {
      ipcRenderer.on('agent:batchProgress', (_event, data) => callback(data));
    },
    onTodoUpdate: (callback) => {
      ipcRenderer.on('agent:todoUpdate', (_event, data) => callback(data));
    },
    onStepResult: (callback) => {
      ipcRenderer.on('agent:stepResult', (_event, data) => callback(data));
    },
    onQuotaExceeded: (callback) => {
      ipcRenderer.on('agent:quotaExceeded', (_event, data) => callback(data));
    },
    onWorkspaceFileAdded: (callback) => {
      ipcRenderer.on('agent:workspaceFileAdded', (_event, data) => callback(data));
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
