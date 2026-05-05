type Extracted = { completionTokens: number; isFinal?: boolean };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pickCompletionTokensFromUsageMeta(meta: unknown): number | null {
  if (!isRecord(meta)) return null;

  // OpenAI usage_metadata typical keys: input_tokens, output_tokens, total_tokens
  const outputTokens = toFiniteNumber(meta.output_tokens);
  if (outputTokens !== null) return outputTokens;

  // Some gateways may use completion_tokens naming
  const completionTokens = toFiniteNumber(meta.completion_tokens);
  if (completionTokens !== null) return completionTokens;

  // Some wrappers expose nested completion/total objects
  const completion = isRecord(meta.completion) ? meta.completion : undefined;
  const nested = completion ? toFiniteNumber(completion.tokens) : null;
  if (nested !== null) return nested;

  return null;
}

function pickCompletionTokensFromTokenUsage(tokenUsage: unknown): number | null {
  if (!isRecord(tokenUsage)) return null;
  const v = toFiniteNumber(tokenUsage.completionTokens);
  if (v !== null) return v;
  const v2 = toFiniteNumber(tokenUsage.completion_tokens);
  if (v2 !== null) return v2;
  return null;
}

/**
 * Extract *real* completion tokens from LangChain callback payloads.
 * No estimation. Only accepts usage fields returned by upstream/gateway.
 */
export function extractCompletionTokensFromLangChain(payload: unknown): Extracted | null {
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const v = extractCompletionTokensFromLangChain(item);
      if (v) return v;
    }
    return null;
  }

  if (!isRecord(payload)) return null;

  // 1) Streaming usage chunk pattern: chunk/message contains usage_metadata
  const directUsageMeta = payload.usage_metadata ?? payload.usageMetadata;
  const fromDirect = pickCompletionTokensFromUsageMeta(directUsageMeta);
  if (fromDirect !== null) return { completionTokens: fromDirect };

  const chunk = payload.chunk;
  if (isRecord(chunk)) {
    const meta = chunk.usage_metadata ?? chunk.usageMetadata;
    const fromChunk = pickCompletionTokensFromUsageMeta(meta);
    if (fromChunk !== null) return { completionTokens: fromChunk };
  }

  const message = payload.message;
  if (isRecord(message)) {
    const meta = message.usage_metadata ?? message.usageMetadata;
    const fromMsg = pickCompletionTokensFromUsageMeta(meta);
    if (fromMsg !== null) return { completionTokens: fromMsg };
  }

  // 2) LLM end output pattern: output.llmOutput.tokenUsage.completionTokens
  const llmOutput = payload.llmOutput;
  if (isRecord(llmOutput)) {
    const tokenUsage = llmOutput.tokenUsage ?? llmOutput.token_usage;
    const fromEnd = pickCompletionTokensFromTokenUsage(tokenUsage);
    if (fromEnd !== null) return { completionTokens: fromEnd, isFinal: true };
  }

  // 3) Some callbacks pass generation-like objects: { generations, llmOutput }
  const output = payload.output;
  if (isRecord(output)) {
    const inner = extractCompletionTokensFromLangChain(output);
    if (inner) return inner;
  }

  return null;
}

