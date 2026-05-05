/**
 * DashScope / 智谱等 OpenAI 兼容网关：LangChain ChatOpenAI 构造（LLM 共用）
 */
import { ChatOpenAI } from '@langchain/openai';
import { getRunContext } from '#backend/application/agent/run-context.js';
import { extractCompletionTokensFromLangChain } from './usage-extract';

export interface CreateLLMOptions {
  apiKey: string;
  endpoint: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  callbacks?: Array<{
    handleLLMStart?: (...args: unknown[]) => void;
    handleLLMNewToken?: (...args: unknown[]) => void;
    handleLLMEnd?: (...args: unknown[]) => void;
  }>;
}

export type ChatModelInstance = InstanceType<typeof ChatOpenAI>;

export function createChatOpenAIModel(options: CreateLLMOptions): ChatModelInstance {
  const { apiKey, endpoint, model, temperature = 0.1, maxTokens = 20000, callbacks = [] } = options;
  const internalCallbacks: CreateLLMOptions['callbacks'] = [
    ...(callbacks ?? []),
    {
      handleLLMNewToken: (...args: unknown[]) => {
        const extracted =
          extractCompletionTokensFromLangChain(args) ??
          args.map((x) => extractCompletionTokensFromLangChain(x)).find((x) => x !== null) ??
          null;
        if (!extracted) return;
        const ctx = getRunContext();
        ctx?.onTokenUsage?.(ctx.threadId, ctx.messageId, extracted.completionTokens, extracted.isFinal);
      },
      handleLLMEnd: (...args: unknown[]) => {
        const extracted =
          extractCompletionTokensFromLangChain(args) ??
          args.map((x) => extractCompletionTokensFromLangChain(x)).find((x) => x !== null) ??
          null;
        if (!extracted) return;
        const ctx = getRunContext();
        ctx?.onTokenUsage?.(ctx.threadId, ctx.messageId, extracted.completionTokens, true);
      },
    },
  ];

  return new ChatOpenAI({
    apiKey,
    modelName: model,
    temperature,
    maxTokens,
    // OpenAI-compatible: request stream usage chunks when supported by gateway.
    // Some gateways only emit final usage; in that case we still emit once in handleLLMEnd.
    streamUsage: true,
    configuration: {
      baseURL: endpoint.replace(/\/$/, ''),
    },
    callbacks: internalCallbacks,
  }) as ChatModelInstance;
}
