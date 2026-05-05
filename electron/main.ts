import { app, BrowserWindow, protocol, Menu } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 尽早加载 .env（与 AgentFactory 一致：从应用根目录读取，避免 dist-electron 运行时 cwd 不对）
const appRoot = __dirname.includes('dist-electron') ? path.join(__dirname, '..') : process.cwd();

/** 窗口/任务栏图标：优先 .ico（内含多分辨率，系统自动选高分辨率），再 fallback PNG */
function getIconPath(): string | null {
  const icoDirs = [
    path.join(appRoot, 'assets'),
    path.join(appRoot, 'public'),
    path.join(appRoot, 'dist'),
    path.join(appRoot, 'build'),
  ];
  for (const dir of icoDirs) {
    const p = path.join(dir, 'favicon.ico');
    if (fs.existsSync(p)) return p;
  }
  const assetsIco = path.join(appRoot, 'assets', 'logo.ico');
  if (fs.existsSync(assetsIco)) return assetsIco;
  const pngNames = ['favicon-256.png', 'favicon-128.png', 'favicon.png', 'icon.png'];
  for (const name of pngNames) {
    for (const dir of icoDirs) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}
const envPath = path.join(appRoot, '.env');
dotenv.config({ path: envPath });
if (process.env.NODE_ENV === 'development') {
  console.log('[Electron] .env path:', envPath, 'exists:', fs.existsSync(envPath));
}

import { log } from './logger.js';
import { handleConfigIPC } from './ipc/config.js';
import { handleStorageIPC } from './ipc/storage.js';
import { handleAgentIPC } from './ipc/agent.js';
import { handleFilesystemIPC } from './ipc/filesystem.js';
import { handleSessionIPC } from './ipc/session.js';
import { handleHITLIPC } from './ipc/hitl.js';
import { handleSyncIPC } from './ipc/sync.js';
import { setDefaultLogRoot } from '../backend/services/log-manager.js';
import { initializeServices, shutdownServices } from '../backend/services/service-initializer.js';
import { loadConfig } from '../backend/app-config.js';
import { initLangSmithEnv } from '../backend/agent/langsmith.js';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const preloadPath = process.env.NODE_ENV === 'development'
    ? path.join(process.cwd(), 'electron', 'preload.cjs')
    : path.join(__dirname, '..', 'electron', 'preload.cjs');
  
  const iconPath = getIconPath();
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: iconPath ?? undefined,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    titleBarStyle: 'default',
  });

  // 开发环境加载 Vite 开发服务器，生产环境加载构建文件
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    // mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  if (app.isPackaged) {
    const exeLogRoot = path.join(path.dirname(process.execPath), 'logs');
    setDefaultLogRoot(exeLogRoot);
  }
  log.info('App ready, userData=', app.getPath('userData'));
  try {
    initLangSmithEnv();
    const config = await loadConfig();
    const outputPath = (config.storage?.outputPath ?? '').trim();
    // 未设置时使用 userData/workspace 作为运行时根目录，避免写入 cwd；同步功能会单独提示用户到配置中设置
    const effectiveOutputPath = outputPath || path.join(app.getPath('userData'), 'workspace');
    process.env.JIAOJIAO_WORKSPACE_ROOT = effectiveOutputPath;
    await initializeServices({ outputPath: effectiveOutputPath });
    console.log('[Electron] Core services initialized');
  } catch (error) {
    console.error('[Electron] Failed to initialize services:', error);
  }

  // 注册自定义协议来服务本地文件
  protocol.registerFileProtocol('local-file', (request, callback) => {
    const url = request.url.replace('local-file://', '');
    try {
      return callback(decodeURIComponent(url));
    } catch (error) {
      console.error('Failed to load local file:', error);
      return callback({ error: -2 }); // FILE_NOT_FOUND
    }
  });

  createWindow();

  // 去掉整个菜单栏（未使用）
  Menu.setApplicationMenu(null);

  // 注册 IPC 处理器
  handleConfigIPC();
  handleStorageIPC();
  handleAgentIPC();
  handleFilesystemIPC();
  handleSessionIPC();
  handleHITLIPC();
  handleSyncIPC();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 在应用退出前优雅关闭所有 runtime
app.on('before-quit', async (event) => {
  event.preventDefault();
  console.log('[Electron] before-quit: shutting down services...');
  await shutdownServices();
  console.log('[Electron] Services shutdown complete');
  app.exit(0);
});

app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
