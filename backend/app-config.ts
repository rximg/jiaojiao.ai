/**
 * 应用配置（electron-store）：与 Electron 主进程/界面共用 userData/config.json。
 * 独立于 agent/ai，供 backend 各模块按需引用，避免 agent ↔ ai 循环依赖。
 */
// 使用路径别名避免 backend 被 tsc include 时相对路径解析问题；与 agent/config 语义一致
import path from 'path';
import type { AppConfig } from '@/types/types';
import Store from 'electron-store';
import { getWorkspaceFilesystem } from './services/fs.js';

const AUDIO_RECORD_FILENAME = 'audio_record.json';
let cachedStore: Store<Partial<AppConfig>> | null = null;
let lastLoggedConfigPath: string | null = null;

/** 非 Electron 环境下使用的 userData 目录，与应用配置路径一致：…/Roaming/jiaojiao（对应 config.json 所在目录） */
function getDefaultUserDataDir(): string {
  const env = process.env.JIAOJIAO_USER_DATA;
  if (env?.trim()) return path.resolve(env.trim());
  const platform = process.platform;
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'), 'jiaojiao');
  }
  if (platform === 'darwin') {
    return path.join(process.env.HOME || '', 'Library', 'Application Support', 'jiaojiao');
  }
  const configBase = process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || '', '.config');
  return path.join(configBase, 'jiaojiao');
}

function getConfigStore(): Store<Partial<AppConfig>> {
  if (cachedStore) return cachedStore;
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      const userData = app.getPath('userData');
      cachedStore = new Store({
        name: 'config',
        cwd: userData,
      } as any) as Store<Partial<AppConfig>>;
      return cachedStore;
    }
  } catch {
    // 非 Electron 或 app 未 ready（如 vitest 中）：使用与开发态 Electron 相同的目录，便于集成测试读到配置
  }
  try {
    const cwd = getDefaultUserDataDir();
    cachedStore = new Store({ name: 'config', cwd } as any) as Store<Partial<AppConfig>>;
    return cachedStore;
  } catch {
    // eslint-disable-next-line no-console
    console.log('[app-config] 使用 mock store（无配置文件）');
    const mock = {
      store: {},
      set: () => {},
      get: () => undefined,
    } as any as Store<Partial<AppConfig>>;
    cachedStore = mock;
    return mock;
  }
}

/** 最近一次 loadConfig 使用的配置文件路径（便于集成测试调试），无文件时为 null */
export let lastLoadedConfigPath: string | null = null;

/** 旧版按能力存 key，迁移为按 provider：有任意能力 key 则填入对应 provider（通义/智谱由 agent.provider 推断） */
function migrateApiKeys(legacy: Record<string, unknown> | undefined, agentProvider?: string): { dashscope: string; zhipu: string } {
  const hasNew = (legacy?.dashscope as string)?.trim() || (legacy?.zhipu as string)?.trim();
  if (hasNew) {
    return {
      dashscope: (legacy?.dashscope as string)?.trim() || '',
      zhipu: (legacy?.zhipu as string)?.trim() || '',
    };
  }
  const llm = (legacy?.llm as string)?.trim();
  const t2i = (legacy?.t2i as string)?.trim();
  const tts = (legacy?.tts as string)?.trim();
  const vl = (legacy?.vl as string)?.trim();
  const anyLegacy = llm || t2i || tts || vl;
  if (anyLegacy && agentProvider === 'zhipu') {
    return { dashscope: '', zhipu: llm || t2i || tts || vl };
  }
  if (anyLegacy) {
    return { dashscope: llm || t2i || tts || vl, zhipu: '' };
  }
  // 仅使用用户目录配置，不使用环境变量
  return { dashscope: '', zhipu: '' };
}

export async function loadConfig(): Promise<AppConfig> {
  const store = getConfigStore();
  const configPath = (store as { path?: string }).path;
  lastLoadedConfigPath = configPath || null;
  if (configPath && configPath !== lastLoggedConfigPath) {
    lastLoggedConfigPath = configPath;
    // eslint-disable-next-line no-console
    console.log('[app-config] 配置文件路径:', configPath);
  }
  try {
    const storedConfig = store.store as Partial<AppConfig>;
    const apiKeys = migrateApiKeys(storedConfig?.apiKeys as Record<string, unknown>, storedConfig?.agent?.provider);
    const storedMultimodal = storedConfig?.multimodalApiKeys as { dashscope?: string; zhipu?: string; jiaojiao?: string } | undefined;
    const llmProvider = storedConfig?.agent?.provider ?? 'dashscope';
    const multimodalProvider = storedConfig?.agent?.multimodalProvider ?? llmProvider;
    const multimodalApiKeys = {
      dashscope: (storedMultimodal?.dashscope ?? storedConfig?.apiKeys?.dashscope ?? '')?.trim() || '',
      zhipu: (storedMultimodal?.zhipu ?? storedConfig?.apiKeys?.zhipu ?? '')?.trim() || '',
      jiaojiao: (storedMultimodal?.jiaojiao ?? '')?.trim() || '',
    };
    const rawHitl = storedConfig?.hitl as { mode?: string; allowlist?: unknown } | undefined;
    const hitlMode = rawHitl?.mode === 'auto' || rawHitl?.mode === 'allowlist' || rawHitl?.mode === 'strict'
      ? rawHitl.mode
      : 'strict';
    const hitlAllowlist = Array.isArray(rawHitl?.allowlist)
      ? Array.from(
          new Set(
            rawHitl.allowlist
              .filter((item): item is string => typeof item === 'string')
              .map((item) => item.trim())
              .filter(Boolean)
          )
        )
      : [];

    return {
      apiKeys: {
        dashscope: apiKeys.dashscope,
        zhipu: apiKeys.zhipu,
      },
      multimodalApiKeys: {
        dashscope: multimodalApiKeys.dashscope,
        zhipu: multimodalApiKeys.zhipu,
        jiaojiao: multimodalApiKeys.jiaojiao,
      },
      agent: {
        model: storedConfig?.agent?.model ?? 'qwen-plus-2025-12-01',
        current: storedConfig?.agent?.current ?? '',
        temperature: storedConfig?.agent?.temperature ?? 0.1,
        maxTokens: storedConfig?.agent?.maxTokens ?? 20000,
        provider: llmProvider,
        multimodalProvider,
      },
      storage: (() => {
        const raw = storedConfig?.storage?.outputPath;
        const trimmed = typeof raw === 'string' ? raw.trim() : '';
        const cwdNorm = path.normalize(path.resolve(process.cwd())).toLowerCase() + path.sep;
        const rawNorm = path.normalize(path.resolve(trimmed)).toLowerCase() + path.sep;
        const isLegacy =
          !trimmed ||
          trimmed === './outputs' ||
          rawNorm === cwdNorm.slice(0, -1) ||
          rawNorm.startsWith(cwdNorm);
        const outputPath = isLegacy ? '' : trimmed;
        const syncRaw = storedConfig?.storage?.syncTargetPath;
        const syncTargetPath = typeof syncRaw === 'string' && syncRaw.trim() ? syncRaw.trim() : outputPath;
        return {
          outputPath,
          syncTargetPath,
          ttsStartNumber: storedConfig?.storage?.ttsStartNumber ?? 6000,
        };
      })(),
      ui: {
        theme: storedConfig?.ui?.theme || 'light',
        language: storedConfig?.ui?.language || 'zh',
      },
      hitl: {
        mode: hitlMode,
        allowlist: hitlAllowlist,
      },
    };
  } catch (error) {
    throw new Error(`无法从用户目录加载配置: ${(error as Error).message}`);
  }
}

/**
 * 保存配置（部分更新，与 electron-store 合并）
 */
export async function saveConfig(updates: Partial<AppConfig>): Promise<void> {
  const store = getConfigStore();
  const setFn = (store as { set?: (k: string, v: unknown) => void }).set;
  if (typeof setFn !== 'function') return;
  const keys = ['apiKeys', 'multimodalApiKeys', 'agent', 'storage', 'ui', 'hitl', 'configVersion'] as const;
  for (const key of keys) {
    if (key in updates && (updates as Record<string, unknown>)[key] !== undefined) {
      setFn.call(store, key, (updates as Record<string, unknown>)[key]);
    }
  }
  // 保存后确保 workspace 下存在 audio_record.json，避免生成音频时无序号
  try {
    const config = await loadConfig();
    const workspace = getWorkspaceFilesystem({ outputPath: config.storage.outputPath });
    try {
      await workspace.readFile(null, AUDIO_RECORD_FILENAME, 'utf-8');
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      const msg = (err as Error)?.message ?? '';
      const notFound = code === 'ENOENT' || (typeof msg === 'string' && msg.includes('File not found'));
      if (notFound) {
        const initial = { nextNumber: config.storage.ttsStartNumber, entries: [] };
        await workspace.writeFileAtomic(null, AUDIO_RECORD_FILENAME, JSON.stringify(initial, null, 2), 'utf-8');
      }
    }
  } catch {
    // 不阻断配置保存
  }
}
