import { describe, it, expect } from 'vitest';
import { shouldAutoApprove } from '../../../backend/services/hitl-policy.js';

describe('HITL 策略决策', () => {
  describe('shouldAutoApprove', () => {
    it('strict 模式：所有 actionType 均不自动通过', () => {
      expect(shouldAutoApprove('strict', new Set(), 'ai.text2image')).toBe(false);
      expect(shouldAutoApprove('strict', new Set(['ai.text2image']), 'ai.text2image')).toBe(false);
      expect(shouldAutoApprove('strict', new Set(['ai.text2image']), 'ai.text2speech')).toBe(false);
      expect(shouldAutoApprove('strict', new Set(['story.plan_review']), 'story.plan_review')).toBe(false);
    });

    it('auto 模式：所有 actionType 均自动通过', () => {
      expect(shouldAutoApprove('auto', new Set(), 'ai.text2image')).toBe(true);
      expect(shouldAutoApprove('auto', new Set(), 'file.delete')).toBe(true);
      expect(shouldAutoApprove('auto', new Set(['ai.text2image']), 'ai.text2speech')).toBe(true);
    });

    it('story.plan_review 在 auto 模式下仍必须人工确认', () => {
      expect(shouldAutoApprove('auto', new Set(), 'story.plan_review')).toBe(false);
    });

    it('allowlist 模式：仅 allowlist 中的 actionType 自动通过', () => {
      const allowlist = new Set(['ai.text2image', 'ai.text2speech']);
      expect(shouldAutoApprove('allowlist', allowlist, 'ai.text2image')).toBe(true);
      expect(shouldAutoApprove('allowlist', allowlist, 'ai.text2speech')).toBe(true);
      expect(shouldAutoApprove('allowlist', allowlist, 'file.delete')).toBe(false);
      expect(shouldAutoApprove('allowlist', new Set(), 'ai.text2image')).toBe(false);
    });

    it('story.plan_review 即使在 allowlist 中也必须人工确认', () => {
      const allowlist = new Set(['story.plan_review']);
      expect(shouldAutoApprove('allowlist', allowlist, 'story.plan_review')).toBe(false);
    });

    it('allowlist 命中规则键（actionType）', () => {
      const allowlist = new Set(['ai.batch_tool_call', 'ai.image_label_order']);
      expect(shouldAutoApprove('allowlist', allowlist, 'ai.batch_tool_call')).toBe(true);
      expect(shouldAutoApprove('allowlist', allowlist, 'ai.image_label_order')).toBe(true);
      expect(shouldAutoApprove('allowlist', allowlist, 'artifacts.delete')).toBe(false);
    });
  });
});
