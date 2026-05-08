/**
 * suggest_caption_regions：VL 建议字幕区（归一化 x,y,w,h），HITL 审图与补充说明
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getMultimodalPortAsync } from '../infrastructure/repositories.js';
import type { GenerateScriptFromImageParams } from '#backend/domain/inference/types.js';
import { defaultNormalizedCaptionRect } from '../services/caption-region-geometry.js';
import type { ToolConfig, ToolContext } from './registry.js';
import { registerTool } from './registry.js';

function create(config: ToolConfig, context: ToolContext) {
  const toolName = config.name ?? 'suggest_caption_regions';
  const description =
    config.description ??
    '根据插画与已确定的字幕文案列表，用视觉模型建议每句字幕在画面上的矩形区域（归一化坐标），需人工确认';
  const promptFromConfig = (config.serviceConfig as { prompt?: string })?.prompt as string | undefined;

  return tool(
    async (params: {
      imagePath: string;
      contextLines: string[];
      sessionId?: string;
      userPrompt?: string;
    }) => {
      const merged = await context.requestApprovalViaHITL('ai.vl_caption_regions', {
        imagePath: params.imagePath,
        contextLines: params.contextLines,
        userPrompt: params.userPrompt,
        sessionId: params.sessionId,
      } as Record<string, unknown>);

      const sessionId = (merged.sessionId as string) || context.getDefaultSessionId();
      const imagePath = merged.imagePath as string;
      const contextLines = (Array.isArray(merged.contextLines) ? merged.contextLines : params.contextLines) as string[];
      const userExtra = typeof merged.userPrompt === 'string' ? merged.userPrompt.trim() : '';

      const ctxBlock =
        contextLines.length > 0
          ? `\n\n【字幕文案】共 ${contextLines.length} 句，请为每一句输出一个矩形区，字段 text 必须与下列字符串完全一致：\n${contextLines.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
          : '';

      const vlUserPrompt = [userExtra, ctxBlock].filter(Boolean).join('\n') || undefined;

      const port = await getMultimodalPortAsync();
      const result = await port.generateScriptFromImage({
        imagePath,
        sessionId,
        userPrompt: vlUserPrompt,
        prompt: promptFromConfig,
      } as GenerateScriptFromImageParams);

      const expectedCount = contextLines.length;
      if (!expectedCount || !Array.isArray((result as { lines?: unknown }).lines)) {
        return result;
      }

      const origLines = (result as { lines: Array<Record<string, unknown>> }).lines;
      const aligned: Array<Record<string, unknown>> = [];

      for (let i = 0; i < expectedCount; i++) {
        const base = (origLines[i] ?? {}) as Record<string, unknown>;
        const def = defaultNormalizedCaptionRect(i, expectedCount);
        aligned.push({
          ...base,
          text: contextLines[i],
          x: typeof base.x === 'number' && Number.isFinite(base.x) ? base.x : def.x,
          y: typeof base.y === 'number' && Number.isFinite(base.y) ? base.y : def.y,
          w: typeof base.w === 'number' && Number.isFinite(base.w) ? base.w : def.w,
          h: typeof base.h === 'number' && Number.isFinite(base.h) ? base.h : def.h,
        });
      }

      return {
        ...(result as Record<string, unknown>),
        lines: aligned,
      };
    },
    {
      name: toolName,
      description,
      schema: z.object({
        imagePath: z.string().describe('插画路径（如 generate_image 返回的 imagePath）'),
        contextLines: z
          .array(z.string())
          .describe('与顺序固定的字幕文案列表，须与后续 captionRubyLines / TTS 使用的字幕一致'),
        sessionId: z.string().optional().describe('会话 ID（留空使用当前会话）'),
        userPrompt: z
          .string()
          .optional()
          .describe('对字幕区布局的补充或修改要求，与系统提示词一并传给 VL'),
      }),
    }
  );
}

registerTool('suggest_caption_regions', create);
