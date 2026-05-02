/**
 * DashScope / 智谱等 OpenAI 兼容网关：LangChain ChatOpenAI 构造（LLM 共用）
 */
import { ChatOpenAI } from '@langchain/openai';

export interface CreateLLMOptions {
  apiKey: string;
  endpoint: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  callbacks?: Array<{ handleLLMStart?: (args: unknown) => void; handleLLMEnd?: (args: unknown) => void }>;
}

export type ChatModelInstance = InstanceType<typeof ChatOpenAI>;

export function createChatOpenAIModel(options: CreateLLMOptions): ChatModelInstance {
  const { apiKey, endpoint, model, temperature = 0.1, maxTokens = 20000, callbacks = [] } = options;
  return new ChatOpenAI({
    apiKey,
    modelName: model,
    temperature,
    maxTokens,
    configuration: {
      baseURL: endpoint.replace(/\/$/, ''),
    },
    callbacks,
  }) as ChatModelInstance;
}
