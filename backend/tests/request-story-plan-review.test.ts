import { describe, expect, it, vi } from 'vitest';
import { createTool } from '../tools/registry.js';
import '../tools/request-story-plan-review.js';

describe('request_story_plan_review tool', () => {
  it('returns merged markdown review payload from HITL', async () => {
    const requestApprovalViaHITL = vi.fn().mockResolvedValue({
      filePath: '绘本故事策划稿.md',
      title: '绘本故事策划稿',
      markdownContent: '# Edited',
      reviewStage: 'story_plan',
    });

    const tool = await createTool(
      'request_story_plan_review',
      {},
      {
        requestApprovalViaHITL,
        getDefaultSessionId: () => 'session-test',
      }
    );

    const result = await tool?.invoke({
      filePath: '绘本故事策划稿.md',
      title: '绘本故事策划稿',
      markdownContent: '# Original',
      reviewStage: 'story_plan',
    });

    expect(requestApprovalViaHITL).toHaveBeenCalledWith(
      'story.plan_review',
      expect.objectContaining({ markdownContent: '# Original' })
    );
    expect(String(result)).toContain('# Edited');
  });
});