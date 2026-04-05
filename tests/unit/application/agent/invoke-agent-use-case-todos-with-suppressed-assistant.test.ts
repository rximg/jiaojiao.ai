import { describe, expect, it, vi } from 'vitest';
import { invokeAgentUseCase } from '../../../../backend/application/agent/invoke-agent-use-case.ts';

describe('invokeAgentUseCase todos when assistant message is not emitted', () => {
  it('still invokes onTodoUpdate in the same chunk as a suppressed assistant message', async () => {
    async function* createStream() {
      yield {
        messages: [{ id: 'assistant-1', type: 'ai', content: '' }],
        todos: [
          { id: '1', content: '生成《绘本故事策划稿.md》', status: 'completed' },
          { id: '2', content: '确认策划稿并固定4角色设定', status: 'in_progress' },
        ],
      };
    }

    const onMessage = vi.fn();
    const onTodoUpdate = vi.fn();

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
          onTodoUpdate,
        },
      }
    );

    expect(onMessage).not.toHaveBeenCalled();
    expect(onTodoUpdate).toHaveBeenCalledTimes(1);
    expect(onTodoUpdate).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({ content: '生成《绘本故事策划稿.md》', status: 'completed' }),
      ])
    );
  });
});
