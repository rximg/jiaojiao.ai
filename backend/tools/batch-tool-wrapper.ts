/**
 * batch_tool_call：通用批量工具执行器
 * LLM 调用时传入单步工具名称 + 参数列表，HITL 一次确认，串行执行，推送 BatchProgress
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ToolConfig, ToolContext } from './registry.js';
import { registerTool, createTool } from './registry.js';
import type { BatchProgress } from './types.js';

function create(_config: ToolConfig, context: ToolContext) {
  return tool(
    async (params: {
      tool: string;
      items: { params: Record<string, unknown>; label?: string }[];
      delayBetweenMs?: number;
    }) => {
      const { tool: singleToolName, items, delayBetweenMs = 0 } = params;

      // ── 1. 单次 HITL 确认 ──
      await context.requestApprovalViaHITL('ai.batch_tool_call', {
        tool: singleToolName,
        _batchMode: true,
        _batchTotal: items.length,
        _batchItems: items.map((it, i) => it.label ?? `#${i + 1}`),
      });

      // ── 2. bypass context（子任务跳过 HITL） ──
      const bypassContext: ToolContext = {
        ...context,
        requestApprovalViaHITL: async (_: string, payload: Record<string, unknown>) => payload,
      };

      // ── 3. 串行执行，推送进度 ──
      const results: unknown[] = [];
      const runCtx = context.getRunContext?.();
      const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const pushProgress = (progress: BatchProgress) => {
        runCtx?.onBatchProgress?.(
          runCtx.threadId,
          runCtx.messageId,
          runCtx.toolCallId,
          progress
        );
      };

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        pushProgress({
          batchId,
          toolName: singleToolName,
          current: i,
          total: items.length,
          currentSubTask: { index: i + 1, label: item.label, status: 'running' },
        });

        if (i > 0 && delayBetweenMs > 0) {
          await new Promise((r) => setTimeout(r, delayBetweenMs));
        }

        // 从 ToolContext 查询单步工具的真实配置
        const singleToolConfig = context.getToolConfig?.(singleToolName) ?? _config;

        try {
          const singleTool = await createTool(singleToolName, singleToolConfig, bypassContext);
          if (!singleTool) throw new Error(`Tool '${singleToolName}' not found or disabled`);
          const result = await singleTool.invoke(item.params as any);
          results.push(result);

          pushProgress({
            batchId,
            toolName: singleToolName,
            current: i + 1,
            total: items.length,
            currentSubTask: { index: i + 1, label: item.label, status: 'completed', result },
          });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          results.push({ error: errMsg });

          pushProgress({
            batchId,
            toolName: singleToolName,
            current: i + 1,
            total: items.length,
            currentSubTask: { index: i + 1, label: item.label, status: 'error', error: errMsg },
          });
        }
      }

      const successCount = results.filter((r) => !(r as any)?.error).length;
      return JSON.stringify({ batchId, tool: singleToolName, total: items.length, completed: successCount, results });
    },
    {
      name: 'batch_tool_call',
      description:
        '批量串行调用单步工具。传入工具名和参数列表，HITL 一次确认，自动显示进度条。' +
        '适用于需要生成多张图片、合成多条语音等场景。',
      schema: z.object({
        tool: z
          .string()
          .describe('要批量调用的单步工具名称，如 generate_image、edit_image、generate_audio'),
        items: z
          .array(
            z.object({
              params: z.record(z.string(), z.unknown()).describe('传给该工具的参数对象'),
              label: z.string().optional().describe('在进度条中显示的标签（如角色名、台词摘要）'),
            })
          )
          .describe('每次调用的参数列表'),
        delayBetweenMs: z
          .number()
          .optional()
          .default(0)
          .describe('每次调用之间的延迟（毫秒），TTS 等需要限流的接口建议设为 2000'),
      }),
    }
  );
}

registerTool('batch_tool_call', create);
