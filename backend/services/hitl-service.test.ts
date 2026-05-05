import { describe, expect, it, vi } from 'vitest';

vi.mock('../app-config.js', () => {
  return {
    loadConfig: async () => ({ hitl: { mode: 'strict', allowlist: [] } }),
  };
});

async function waitUntil(fn: () => boolean, maxTurns = 50) {
  for (let i = 0; i < maxTurns; i++) {
    if (fn()) return;
    await Promise.resolve();
  }
  throw new Error('waitUntil timeout');
}

describe('HITLService', () => {
  it('serializes concurrent requestApproval calls instead of throwing', async () => {
    const { HITLService } = await import('./hitl-service.js');
    const sendCalls: { requestId: string; actionType: string }[] = [];
    const resolvers = new Map<string, (r: { approved: boolean; payload?: Record<string, unknown> }) => void>();

    // Make strict mode deterministic (no auto-approve)
    const svc = new HITLService(
      's-1',
      undefined,
      undefined,
      async (request) =>
        await new Promise((resolve) => {
          sendCalls.push({ requestId: request.requestId, actionType: request.actionType });
          resolvers.set(request.requestId, resolve);
        })
    );

    const p1 = svc.requestApproval('a.one', { x: 1 });
    await waitUntil(() => sendCalls.length === 1);

    // Call p2 before responding to p1; it should queue instead of throwing
    const p2 = svc.requestApproval('a.two', { y: 2 });

    // Only first request should be sent so far
    expect(sendCalls.length).toBe(1);

    // Approve first; then second should be sent
    const r1id = sendCalls[0]!.requestId;
    resolvers.get(r1id)!({ approved: true, payload: { x: 9 } });
    const r1 = await p1;
    expect(r1).toEqual({ x: 9 });

    // Allow queued second to progress
    await waitUntil(() => sendCalls.length === 2);

    const r2id = sendCalls[1]!.requestId;
    resolvers.get(r2id)!({ approved: true, payload: { y: 8 } });
    const r2 = await p2;
    expect(r2).toEqual({ y: 8 });
  });
});

