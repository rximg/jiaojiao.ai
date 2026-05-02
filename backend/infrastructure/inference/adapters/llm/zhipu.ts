/**
 * 智谱（GLM）LLM 适配：同步接口，仅 endpoint
 */
import type { LLMAIConfig } from '#backend/domain/inference/types.js';
import {
  createChatOpenAIModel,
  type ChatModelInstance,
  type CreateLLMOptions,
} from '../openai-compatible/create-chat-openai-model.js';

export type { ChatModelInstance, CreateLLMOptions };

export const createLLMZhipu = createChatOpenAIModel;

export function createLLMFromConfig(
  cfg: LLMAIConfig,
  callbacks: CreateLLMOptions['callbacks']
): ChatModelInstance {
  return createChatOpenAIModel({
    apiKey: cfg.apiKey,
    endpoint: cfg.endpoint,
    model: cfg.model,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    callbacks,
  });
}
