import { describe, expect, it } from 'vitest';
import type { Message } from '../../../src/types/types';
import { isRenderableMessage, sanitizeMessages } from '../../../src/lib/chat-messages';

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
});