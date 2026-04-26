/**
 * AI 能力配置：从 app-config + ai_models.json 解析 provider、apiKey、model、endpoint。
 * 仅从 ai_models.json 加载 URL（不读环境变量）。仅在 Agent 构建时调用。
 */
import path from 'path';
import { promises as fs } from 'fs';
import { loadConfig } from '../../app-config.js';
import type {
  Provider,
  AIAbility,
  LLMAIConfig,
  VLAIConfig,
  TTSAIConfig,
  T2IAIConfig,
  ImageEditAIConfig,
  AIConfig,
  AiModelsSchema,
  ProviderAbilityModelsConfig,
  JiaojiaoProviderConfig,
} from '#backend/domain/inference/types.js';

/** 能力块在 ai_models.json 中可包含的 URL 与异步轮询配置 */
interface AbilityBlockWithUrls extends ProviderAbilityModelsConfig {
  endpoint?: string;
  legacyEndpoint?: string;
  taskEndpoint?: string;
  poll_interval_ms?: number;
  max_poll_attempts?: number;
}

function getConfigDir(): string {
  if (process.env.AGENT_CONFIG_DIR) {
    return path.resolve(process.env.AGENT_CONFIG_DIR);
  }
  return path.join(process.cwd(), 'backend', 'config');
}

async function loadAiModels(): Promise<AiModelsSchema> {
  try {
    const configDir = getConfigDir();
    const filePath = path.join(configDir, 'ai_models.json');
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as AiModelsSchema;
  } catch (e) {
    throw new Error(`未能获取到 ai_models.json: ${(e as Error).message}`);
  }
}

function getAbilityBlock(schema: AiModelsSchema, provider: Provider, ability: AIAbility): AbilityBlockWithUrls {
  const block = (schema[provider]?.[ability] ?? schema.dashscope?.[ability]) as AbilityBlockWithUrls | undefined;
  if (block?.models?.length) return block;
  return {
    default:
      ability === 'llm'
        ? 'qwen-plus-2025-12-01'
        : ability === 'vl'
          ? 'qwen3-vl-plus'
          : ability === 'tts'
            ? 'qwen-tts'
            : 'wan2.6-t2i',
    models: [],
  };
}

function resolveModel(abilityConfig: ProviderAbilityModelsConfig, specifiedModel?: string | null): string {
  const modelId = specifiedModel?.trim();
  const found = modelId ? abilityConfig.models.some((m) => m.id === modelId) : false;
  return found && modelId ? modelId : (abilityConfig.default || abilityConfig.models[0]?.id || '');
}

function resolveProviderForAbility(agentProvider: Provider | undefined, ability: AIAbility): Provider {
  const envProvider = process.env.TEST_API_PROVIDER;
  if (envProvider === 'zhipu' || envProvider === 'dashscope') return envProvider;
  // jiaojiao 仅提供多模态网关能力，LLM 仍使用 dashscope/zhipu。
  if (envProvider === 'jiaojiao' && ability !== 'llm') return 'jiaojiao';
  if (agentProvider !== 'zhipu' && agentProvider !== 'dashscope' && agentProvider !== 'jiaojiao') {
    throw new Error(
      '未配置 AI 供应商（agent.provider）：请在应用设置中选择通义（dashscope）、智谱（zhipu）或嘉嘉（jiaojiao）后再使用'
    );
  }
  return agentProvider;
}

function requireUrl(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`ai_models.json 中未配置 ${label}`);
  return trimmed.replace(/\/$/, '');
}

/**
 * 获取指定能力的 AI 配置（provider、apiKey、model、endpoint）。
 * URL 仅从 ai_models.json 对应 provider/ability 块加载。
 */
export async function getAIConfig(ability: AIAbility): Promise<AIConfig> {
  const appConfig = await loadConfig();
  const apiKeys = appConfig.apiKeys as { dashscope?: string; zhipu?: string };
  const multimodalApiKeys = (appConfig.multimodalApiKeys ?? appConfig.apiKeys) as {
    dashscope?: string;
    zhipu?: string;
    jiaojiao?: string;
  };
  const aiModels = await loadAiModels();
  const agent = appConfig.agent as {
    model?: string;
    current?: string;
    provider?: Provider;
    multimodalProvider?: Provider;
    temperature?: number;
    maxTokens?: number;
  };
  const isLlm = ability === 'llm';
  const provider: Provider = resolveProviderForAbility(
    isLlm ? agent?.provider : (agent?.multimodalProvider ?? agent?.provider),
    ability
  );

  // ── jiaojiao 分支：复用 DashScope 适配器，endpoint 指向本地网关 ─────────────────
  if (provider === 'jiaojiao' && !isLlm) {
    const jiaojiaoSection = aiModels.jiaojiao as JiaojiaoProviderConfig | undefined;
    if (!jiaojiaoSection?.gatewayUrl) {
      throw new Error('ai_models.json 中未找到 jiaojiao.gatewayUrl，请检查配置');
    }
    const apiKey = (multimodalApiKeys.jiaojiao ?? '').trim();
    if (!apiKey) {
      throw new Error('未配置嘉嘉网关密钥：请在应用设置中填写嘉嘉（jiaojiao）API Key');
    }
    const abilityBlock = getAbilityBlock(aiModels, provider, ability);
    const model = resolveModel(abilityBlock, agent?.model?.trim() || undefined);

    switch (ability) {
      case 'vl': {
        const endpoint = requireUrl(
          (abilityBlock as AbilityBlockWithUrls).endpoint,
          'jiaojiao.vl.endpoint'
        );
        const cfg: VLAIConfig = { provider: 'jiaojiao', apiKey, endpoint, model, prompt: '' };
        return cfg;
      }
      case 'tts': {
        const endpoint = requireUrl(
          (abilityBlock as AbilityBlockWithUrls).endpoint,
          'jiaojiao.tts.endpoint'
        );
        const taskEndpoint = (abilityBlock as AbilityBlockWithUrls).taskEndpoint?.trim()
          ? (abilityBlock as AbilityBlockWithUrls).taskEndpoint!.replace(/\/$/, '')
          : undefined;
        const cfg: TTSAIConfig = {
          provider: 'jiaojiao',
          apiKey,
          endpoint,
          ...(taskEndpoint && { taskEndpoint }),
          model,
          ...((abilityBlock as AbilityBlockWithUrls).poll_interval_ms != null && {
            poll_interval_ms: (abilityBlock as AbilityBlockWithUrls).poll_interval_ms,
          }),
          ...((abilityBlock as AbilityBlockWithUrls).max_poll_attempts != null && {
            max_poll_attempts: (abilityBlock as AbilityBlockWithUrls).max_poll_attempts,
          }),
        };
        return cfg;
      }
      case 't2i': {
        const endpoint = requireUrl(
          (abilityBlock as AbilityBlockWithUrls).endpoint,
          'jiaojiao.t2i.endpoint'
        );
        const taskEndpoint = requireUrl(
          (abilityBlock as AbilityBlockWithUrls).taskEndpoint,
          'jiaojiao.t2i.taskEndpoint'
        );
        const cfg: T2IAIConfig = {
          provider: 'jiaojiao',
          apiKey,
          endpoint,
          taskEndpoint,
          model,
          ...((abilityBlock as AbilityBlockWithUrls).poll_interval_ms != null && {
            poll_interval_ms: (abilityBlock as AbilityBlockWithUrls).poll_interval_ms,
          }),
          ...((abilityBlock as AbilityBlockWithUrls).max_poll_attempts != null && {
            max_poll_attempts: (abilityBlock as AbilityBlockWithUrls).max_poll_attempts,
          }),
        };
        return cfg;
      }
      default:
        throw new Error(`jiaojiao 不支持 ${ability} 能力`);
    }
  }

  const abilityBlock = getAbilityBlock(aiModels, provider, ability);
  const raw = (ability === 'llm' ? (agent?.current ?? agent?.model) : agent?.model)?.trim();
  const specifiedModelForUser = raw || undefined;

  const getApiKey = (p: Provider): string => {
    const key = isLlm
      ? (p === 'zhipu' ? apiKeys.zhipu : apiKeys.dashscope)?.trim() ?? ''
      : (multimodalApiKeys[p] ?? '').trim();
    if (!key) {
      const label = isLlm ? 'LLM' : '多模态（视觉/语音/图像）';
      throw new Error(
        `未配置 ${label} API Key：请在应用设置中配置${p === 'zhipu' ? '智谱（Zhipu）' : '通义（DashScope）'}的 API Key`
      );
    }
    return key;
  };

  const model = resolveModel(abilityBlock, specifiedModelForUser);
  const apiKey = getApiKey(provider);

  switch (ability) {
    case 'llm': {
      const endpoint = requireUrl(abilityBlock.endpoint, `${provider}.llm.endpoint`);
      const cfg: LLMAIConfig = {
        provider,
        apiKey,
        endpoint,
        model,
        temperature: agent?.temperature ?? 0.1,
        maxTokens: agent?.maxTokens ?? 20000,
      };
      return cfg;
    }
    case 'vl': {
      const endpoint = requireUrl(abilityBlock.endpoint, `${provider}.vl.endpoint`);
      const cfg: VLAIConfig = {
        provider,
        apiKey,
        endpoint,
        model,
        prompt: '', // 由 tools 从 config/tools/vl_script.yaml 读取并传入端口
      };
      return cfg;
    }
    case 'tts': {
      const endpoint = requireUrl(abilityBlock.endpoint, `${provider}.tts.endpoint`);
      const taskEndpoint = abilityBlock.taskEndpoint?.trim()
        ? abilityBlock.taskEndpoint.replace(/\/$/, '')
        : undefined;
      const poll_interval_ms = abilityBlock.poll_interval_ms;
      const max_poll_attempts = abilityBlock.max_poll_attempts;
      const cfg: TTSAIConfig = {
        provider,
        apiKey,
        endpoint,
        ...(taskEndpoint && { taskEndpoint }),
        model,
        ...(poll_interval_ms != null && { poll_interval_ms }),
        ...(max_poll_attempts != null && { max_poll_attempts }),
      };
      return cfg;
    }
    case 't2i': {
      const endpoint = requireUrl(abilityBlock.endpoint, `${provider}.t2i.endpoint`);
      const taskEndpoint = requireUrl(abilityBlock.taskEndpoint, `${provider}.t2i.taskEndpoint`);
      const legacyEndpoint = (abilityBlock as AbilityBlockWithUrls).legacyEndpoint?.trim()
        ? requireUrl((abilityBlock as AbilityBlockWithUrls).legacyEndpoint, `${provider}.t2i.legacyEndpoint`)
        : undefined;
      const poll_interval_ms = abilityBlock.poll_interval_ms;
      const max_poll_attempts = abilityBlock.max_poll_attempts;
      const cfg: T2IAIConfig = {
        provider,
        apiKey,
        endpoint,
        ...(legacyEndpoint && { legacyEndpoint }),
        taskEndpoint,
        model,
        ...(poll_interval_ms != null && { poll_interval_ms }),
        ...(max_poll_attempts != null && { max_poll_attempts }),
      };
      return cfg;
    }
    case 'image_edit': {
      const endpoint = requireUrl(abilityBlock.endpoint, `${provider}.image_edit.endpoint`);
      const taskEndpoint = abilityBlock.taskEndpoint?.trim()
        ? abilityBlock.taskEndpoint.replace(/\/$/, '')
        : undefined;
      const poll_interval_ms = abilityBlock.poll_interval_ms;
      const max_poll_attempts = abilityBlock.max_poll_attempts;
      const cfg: ImageEditAIConfig = {
        provider,
        apiKey,
        endpoint,
        model,
        ...(taskEndpoint && { taskEndpoint }),
        ...(poll_interval_ms != null && { poll_interval_ms }),
        ...(max_poll_attempts != null && { max_poll_attempts }),
      };
      return cfg;
    }
    default:
      throw new Error(`Unknown ability: ${ability}`);
  }
}
