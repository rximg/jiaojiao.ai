import { describe, expect, it } from 'vitest';
import type { Message } from '../../../src/types/types';
import {
  isRenderableMessage,
  mergeToolCallsIntoMessages,
  sanitizeMessages,
} from '../../../src/lib/chat-messages';

function createAssistantMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    timestamp: new Date('2026-03-23T00:00:00.000Z'),
    ...overrides,
  };
}

describe('chat message visibility', () => {
  it('treats pure empty assistant messages as non-renderable', () => {
    expect(isRenderableMessage(createAssistantMessage())).toBe(false);
  });

  it('keeps empty assistant messages that carry a HITL block', () => {
    expect(
      isRenderableMessage(
        createAssistantMessage({
          hitlBlock: {
            requestId: 'req-1',
            actionType: 'confirm_image_prompt',
            payload: {},
            approved: true,
          },
        })
      )
    ).toBe(true);
  });

  it('keeps empty assistant messages with pending HITL status', () => {
    expect(
      isRenderableMessage(
        createAssistantMessage({
          hitlBlock: {
            requestId: 'req-p',
            actionType: 'ai.text2image',
            payload: { prompt: 'x' },
            status: 'pending',
          },
        })
      )
    ).toBe(true);
  });

  it('dedupes assistant HITL rows that share the same requestId', () => {
    const hitlBlock = {
      requestId: 'rid-dup',
      actionType: 'story.plan_review',
      payload: {},
      status: 'approved' as const,
    };
    const first = createAssistantMessage({ id: 'h1', hitlBlock });
    const dup = createAssistantMessage({ id: 'h2', hitlBlock: { ...hitlBlock } });
    const user: Message = {
      id: 'user-1',
      role: 'user',
      content: '你好',
      timestamp: new Date('2026-03-23T00:00:00.000Z'),
    };
    const out = sanitizeMessages([user, first, dup]);
    expect(out.map((m) => m.id)).toEqual(['user-1', 'h1']);
  });

  it('keeps distinct HITL requestIds when sanitizing', () => {
    const a = createAssistantMessage({
      id: 'h1',
      hitlBlock: { requestId: 'r1', actionType: 'ai.text2speech', payload: {}, status: 'pending' },
    });
    const b = createAssistantMessage({
      id: 'h2',
      hitlBlock: { requestId: 'r2', actionType: 'ai.text2speech', payload: {}, status: 'pending' },
    });
    expect(sanitizeMessages([a, b])).toHaveLength(2);
  });

  it('removes empty assistant messages from persisted message lists', () => {
    const kept = createAssistantMessage({ id: 'assistant-keep', content: '有内容' });
    const hitl = createAssistantMessage({
      id: 'assistant-hitl',
      hitlBlock: {
        requestId: 'req-2',
        actionType: 'confirm_script',
        payload: {},
        approved: false,
      },
    });
    const empty = createAssistantMessage({ id: 'assistant-empty' });
    const user: Message = {
      id: 'user-1',
      role: 'user',
      content: '你好',
      timestamp: new Date('2026-03-23T00:00:00.000Z'),
    };

    expect(sanitizeMessages([user, empty, kept, hitl]).map((message) => message.id)).toEqual([
      'user-1',
      'assistant-keep',
      'assistant-hitl',
    ]);
  });

  it('keeps empty assistant messages that carry tool calls', () => {
    expect(
      isRenderableMessage(
        createAssistantMessage({
          toolCalls: [
            {
              id: 'tool-1',
              name: 'generate_image',
              args: { prompt: '小熊' },
              status: 'pending',
            },
          ],
        })
      )
    ).toBe(true);
  });

  it('merges tool calls into the matching assistant message', () => {
    const messages: Message[] = [
      {
        id: 'user-1',
        role: 'user',
        content: '画一只小熊',
        timestamp: new Date('2026-03-23T00:00:00.000Z'),
      },
      createAssistantMessage({
        id: 'assistant-1',
        content: '我来生成角色图。',
      }),
    ];

    const nextMessages = mergeToolCallsIntoMessages(messages, 'assistant-1', [
      {
        id: 'tool-1',
        name: 'generate_image',
        args: { prompt: '小熊在森林里' },
        status: 'pending',
      },
    ]);

    expect(nextMessages.find((message) => message.id === 'assistant-1')?.toolCalls).toEqual([
      {
        id: 'tool-1',
        name: 'generate_image',
        args: { prompt: '小熊在森林里' },
        status: 'pending',
      },
    ]);
  });
});