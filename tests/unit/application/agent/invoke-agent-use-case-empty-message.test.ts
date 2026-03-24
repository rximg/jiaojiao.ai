import { describe, expect, it, vi } from 'vitest';
import { invokeAgentUseCase } from '../../../../backend/application/agent/invoke-agent-use-case.ts';

describe('invokeAgentUseCase empty assistant chunks', () => {
  it('skips empty assistant chunks until there is visible content', async () => {
    async function* createStream() {
      yield {
        messages: [
          { id: 'assistant-1', type: 'ai', content: '' },
        ],
      };

      yield {
        messages: [
          { id: 'assistant-1', type: 'ai', content: '现在我将固定4个角色设定，并生成四宫格角色图。' },
        ],
      };
    }

    const onMessage = vi.fn();

    await invokeAgentUseCase(
      {
        createAgent: async () => ({
          stream: async () => createStream(),
        }),
        getSessionMessages: async () => [],
      },
      {
        message: 'test',
        signal: new AbortController().signal,
        callbacks: {
          onMessage,
        },
      }
    );

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(
      expect.any(String),
      [
        expect.objectContaining({
          id: 'assistant-1',
          role: 'assistant',
          content: '现在我将固定4个角色设定，并生成四宫格角色图。',
        }),
      ]
    );
  });
});