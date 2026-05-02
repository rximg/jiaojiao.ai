/**
 * LLM 工厂：根据 provider 创建 LangChain Chat 模型（构建时由 getAIConfig('llm') 注入）
 */
import type { Provider, LLMAIConfig } from '#backend/domain/inference/types.js';
import { createChatOpenAIModel } from '../openai-compatible/create-chat-openai-model.js';
import { type CreateLLMOptions, type ChatModelInstance } from './dashscope.js';

export type { ChatModelInstance, CreateLLMOptions };

export interface CreateLLMParams extends LLMAIConfig {
  callbacks?: CreateLLMOptions['callbacks'];
}

/** DashScope 与智谱当前均走 OpenAI 兼容 ChatOpenAI 配置，实现相同 */
export function createLLM(_provider: Provider, options: CreateLLMOptions): ChatModelInstance {
  return createChatOpenAIModel(options);
}

export function createLLMFromAIConfig(cfg: CreateLLMParams): ChatModelInstance {
  const opts: CreateLLMOptions = {
    apiKey: cfg.apiKey,
    endpoint: cfg.endpoint,
    model: cfg.model,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    callbacks: cfg.callbacks,
  };
  return createLLM(cfg.provider, opts);
}
