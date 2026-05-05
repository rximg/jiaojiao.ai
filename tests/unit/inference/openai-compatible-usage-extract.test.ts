import { describe, expect, it } from 'vitest';
import { extractCompletionTokensFromLangChain } from '../../../backend/infrastructure/inference/adapters/openai-compatible/usage-extract.js';

describe('openai-compatible usage extract', () => {
  it('extracts completion tokens from usage_metadata (stream chunk)', () => {
    const payload = { chunk: { usage_metadata: { output_tokens: 123 } } };
    expect(extractCompletionTokensFromLangChain(payload)).toEqual({ completionTokens: 123 });
  });

  it('extracts completion tokens from llmOutput.tokenUsage (end)', () => {
    const payload = { llmOutput: { tokenUsage: { completionTokens: 77 } } };
    expect(extractCompletionTokensFromLangChain(payload)).toEqual({ completionTokens: 77, isFinal: true });
  });

  it('returns null when usage not present', () => {
    expect(extractCompletionTokensFromLangChain({ foo: 1 })).toBeNull();
  });
});

