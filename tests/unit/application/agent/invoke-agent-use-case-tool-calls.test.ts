import { describe, expect, it, vi } from 'vitest';
import { invokeAgentUseCase } from '../../../../backend/application/agent/invoke-agent-use-case.ts';

describe('invokeAgentUseCase tool calls', () => {
  it('emits tool calls with the assistant message id they belong to', async () => {
    async function* createStream() {
      yield {
        messages: [
          { id: 'assistant-1', type: 'ai', content: '我先调用工具生成图片。' },
        ],
      };

      yield {
        tool_calls: [
          {
            id: 'tool-1',
            name: 'generate_image',
            args: { prompt: '森林里的小熊' },
            status: 'pending',
          },
        ],
      };
    }

    const onToolCall = vi.fn();

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
          onMessage: vi.fn(),
          onToolCall,
        },
      }
    );

    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(onToolCall).toHaveBeenCalledWith(
      expect.any(String),
      'assistant-1',
      [
        expect.objectContaining({
          id: 'tool-1',
          name: 'generate_image',
        }),
      ]
    );
  });
});
