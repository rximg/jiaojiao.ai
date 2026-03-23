import { describe, expect, it } from 'vitest';
import { getHITLRule } from '../config/hitl-config.js';

describe('story.plan_review HITL rule', () => {
  it('requires manual approval', () => {
    const rule = getHITLRule('story.plan_review');

    expect(rule).toBeDefined();
    expect(rule?.enabled).toBe(true);
    expect(rule?.requireApproval).toBe(true);
    expect(rule?.priority).toBe('medium');
  });
});