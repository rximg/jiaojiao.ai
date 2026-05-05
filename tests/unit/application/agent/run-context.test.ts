import { describe, expect, it, expectTypeOf } from 'vitest';

import type { RunContext } from '../../../../backend/application/agent/run-context.js';

describe('RunContext', () => {
  it('exposes onTokenUsage callback in types', () => {
    const ctx: RunContext = {
      threadId: 't1',
      messageId: 'm1',
      onTokenUsage: (threadId, messageId, completionTokens, isFinal) => {
        expect(threadId).toBe('t1');
        expect(messageId).toBe('m1');
        expect(completionTokens).toBe(123);
        expect(isFinal).toBe(true);
      },
    };

    ctx.onTokenUsage?.('t1', 'm1', 123, true);

    expectTypeOf(ctx.onTokenUsage).toBeFunction();
  });
});

