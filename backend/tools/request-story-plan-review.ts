import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ToolConfig, ToolContext } from './registry.js';
import { registerTool } from './registry.js';

function create(config: ToolConfig, context: ToolContext) {
  return tool(
    async (params: {
      filePath: string;
      title?: string;
      markdownContent: string;
      reviewStage?: string;
      allowEdit?: boolean;
      confirmText?: string;
      cancelText?: string;
    }) => {
      const merged = await context.requestApprovalViaHITL('story.plan_review', {
        filePath: params.filePath,
        title: params.title ?? '绘本故事策划稿',
        markdownContent: params.markdownContent,
        reviewStage: params.reviewStage ?? 'story_plan',
        allowEdit: params.allowEdit ?? true,
        confirmText: params.confirmText ?? '确认策划稿',
        cancelText: params.cancelText ?? '退回修改',
      });

      return JSON.stringify({
        filePath: merged.filePath,
        title: merged.title,
        markdownContent: merged.markdownContent,
        reviewStage: merged.reviewStage,
        allowEdit: merged.allowEdit,
      });
    },
    {
      name: config.name ?? 'request_story_plan_review',
      description: config.description ?? '触发绘本故事策划稿的人工确认',
      schema: z.object({
        filePath: z.string().describe('待确认 Markdown 文件路径'),
        title: z.string().optional().describe('确认卡片标题'),
        markdownContent: z.string().describe('待确认的 Markdown 正文'),
        reviewStage: z.string().optional().describe('业务阶段标识，默认 story_plan'),
        allowEdit: z.boolean().optional().describe('是否允许用户在 HITL 中编辑 Markdown'),
        confirmText: z.string().optional().describe('确认按钮文案'),
        cancelText: z.string().optional().describe('取消按钮文案'),
      }),
    }
  );
}

registerTool('request_story_plan_review', create);