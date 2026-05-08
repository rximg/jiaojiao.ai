import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import type { AppConfig } from '../types/types';

interface ConfigContextType {
  config: AppConfig | null;
  updateConfig: (newConfig: Partial<AppConfig>) => Promise<void>;
  reloadUIForCase: (caseId: string) => Promise<void>;
  isLoading: boolean;
  /** 无 config.json 或未配置 API Key 时需弹出配置窗口 */
  needApiKeyConfig: boolean;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

/** dev StrictMode 下会 mount/unmount/mount，需跨实例去重首次加载 */
let initialLoadPromise: Promise<void> | null = null;

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [needApiKeyConfig, setNeedApiKeyConfig] = useState(false);

  const loadConfig = useCallback(async (caseId?: string) => {
    try {
      if (!window.electronAPI?.config) {
        console.warn('electronAPI.config not available, using default config');
        setNeedApiKeyConfig(true);
        setIsLoading(false);
        return;
      }
      const raw = await window.electronAPI.config.get(caseId);
      const resolved =
        raw && typeof raw === 'object' && 'config' in raw
          ? (raw as { config: AppConfig; isFirstRun?: boolean })
          : { config: raw as AppConfig, isFirstRun: false };
      const savedConfig = resolved.config ?? null;
      const isFirstRun = resolved.isFirstRun === true;
      setConfig(savedConfig);
      const noApiKey = !savedConfig?.apiKeys?.dashscope?.trim() && !savedConfig?.apiKeys?.zhipu?.trim();
      setNeedApiKeyConfig(isFirstRun || noApiKey);
    } catch (error) {
      console.error('Failed to load config:', error);
      setNeedApiKeyConfig(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialLoadPromise) {
      initialLoadPromise = loadConfig();
    } else {
      // 复用同一次加载，避免 StrictMode 双次 IPC
      void initialLoadPromise;
    }
  }, [loadConfig]);

  const reloadUIForCase = async (caseId: string) => {
    try {
      if (!window.electronAPI?.config) return;
      const raw = await window.electronAPI.config.get(caseId);
      const resolved =
        raw && typeof raw === 'object' && 'config' in raw
          ? (raw as { config: AppConfig }).config
          : (raw as AppConfig);
      if (resolved) {
        setConfig((prev) => prev ? { ...prev, ui: resolved.ui } : resolved);
      }
    } catch (error) {
      console.error('Failed to reload UI config for case:', caseId, error);
    }
  };

  const updateConfig = async (newConfig: Partial<AppConfig>) => {
    try {
      if (!window.electronAPI?.config) {
        throw new Error('electronAPI.config is not available');
      }
      const baseConfig: AppConfig = config || {
        apiKeys: { dashscope: '', zhipu: '' },
        multimodalApiKeys: { dashscope: '', zhipu: '' },
        agent: { model: 'qwen-plus-2025-12-01', temperature: 0.1, maxTokens: 20000, provider: 'dashscope', multimodalProvider: 'dashscope' },
        storage: { outputPath: '', syncTargetPath: '' },
        ui: { theme: 'light', language: 'zh' },
        hitl: { mode: 'strict', allowlist: [] },
      };
      const updatedConfig = { ...baseConfig, ...newConfig } as AppConfig;
      await window.electronAPI.config.set(updatedConfig);
      setConfig(updatedConfig);
      if (updatedConfig.apiKeys?.dashscope?.trim() || updatedConfig.apiKeys?.zhipu?.trim()) {
        setNeedApiKeyConfig(false);
      }
    } catch (error) {
      console.error('Failed to update config:', error);
      throw error;
    }
  };

  return (
    <ConfigContext.Provider value={{ config, updateConfig, reloadUIForCase, isLoading, needApiKeyConfig }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  const context = useContext(ConfigContext);
  if (context === undefined) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return context;
}
