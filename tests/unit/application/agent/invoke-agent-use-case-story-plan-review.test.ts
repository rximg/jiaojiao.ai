import { describe, expect, it, vi } from 'vitest';
import { invokeAgentUseCase } from '../../../../backend/application/agent/invoke-agent-use-case.ts';

describe('invokeAgentUseCase story plan review payload filtering', () => {
  it('skips raw story plan review payload JSON and only emits visible assistant text', async () => {
    const reviewPayload = JSON.stringify({
      filePath: '/绘本故事策划稿.md',
      title: '《小熊学习爬树》绘本故事策划稿',
      markdownContent: '# 绘本故事策划稿\n\n## 故事主题\n- 主题：小熊学习爬树',
      reviewStage: 'story_plan',
      allowEdit: true,
    });

    async function* createStream() {
      yield {
        messages: [
          { id: 'assistant-1', type: 'ai', content: reviewPayload },
        ],
      };

      yield {
        messages: [
          { id: 'assistant-2', type: 'ai', content: '请先确认策划稿，我会在确认后继续生成角色图。' },
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
          id: 'assistant-2',
          role: 'assistant',
          content: '请先确认策划稿，我会在确认后继续生成角色图。',
        }),
      ]
    );
  });
});