/**
 * generate_audio：生成单条音频（供 batch_tool_call 内部调用）
 */
import path from 'path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { SynthesizeSpeechItem } from '#backend/domain/inference/types.js';
import { getMultimodalPortAsync } from '../infrastructure/repositories.js';
import { readLineNumbers, appendEntries } from './line-numbers.js';
import { loadConfig } from '../app-config.js';
import type { ToolConfig, ToolContext } from './registry.js';
import { registerTool } from './registry.js';

function sanitizeForFilename(text: string, maxLen = 40): string {
  const noPunctuation = text.replace(/[\s\p{P}\p{S}]/gu, '').trim();
  const truncated = noPunctuation.slice(0, maxLen);
  const safe = truncated.replace(/[/\\:*?"<>|]/g, '_');
  return safe || 'line';
}

function create(config: ToolConfig, context: ToolContext) {
  const toolName = config.name ?? 'generate_audio';
  const description = config.description ?? '生成单条音频（内部工具，供批量壳层调用）';
  const serviceConfig = config.serviceConfig as {
    default_params?: Record<string, unknown>;
  };
  const defaultParams = serviceConfig?.default_params ?? {};
  const defaultVoice = (defaultParams.voice as string) ?? 'chinese_female';
  const defaultFormat = (defaultParams.format as string) ?? 'mp3';

  return tool(
    async (params: { text: string; voice?: string; format?: string; sessionId?: string }) => {
      const merged = await context.requestApprovalViaHITL(
        'ai.text2speech',
        params as Record<string, unknown>
      );
      const sessionId = (merged.sessionId as string) || context.getDefaultSessionId();
      const text = (merged.text as string) ?? '';
      if (!text.trim()) throw new Error('text is required');

      const voice = (merged.voice as string) ?? defaultVoice;
      const format = (merged.format as string) ?? defaultFormat;

      const appConfig = await loadConfig();
      const ttsStartNumber = appConfig.storage?.ttsStartNumber ?? 6000;
      const { nextNumber } = await readLineNumbers(ttsStartNumber);
      const relativePath = path.posix.join(
        'audio',
        `${nextNumber}_${sanitizeForFilename(text)}.${format}`
      );

      const port = await getMultimodalPortAsync();
      const item: SynthesizeSpeechItem = {
        text,
        relativePath,
        number: nextNumber,
      };
      const ttsResult = await port.synthesizeSpeech({
        items: [item],
        voice,
        format,
        sessionId,
        rateLimitMs: 0,
      });
      if (ttsResult.audioPaths.length < 1 || ttsResult.audioUris.length < 1) {
        throw new Error('synthesizeSpeech returned no audio for single item');
      }
      const audioPath = ttsResult.audioPaths[0];
      const audioUri = ttsResult.audioUris[0];

      await appendEntries(
        [{ number: nextNumber, sessionId, relativePath, text }],
        ttsStartNumber
      );

      return JSON.stringify({
        audioPath,
        audioUri,
        number: nextNumber,
        text,
        sessionId,
      });
    },
    {
      name: toolName,
      description,
      schema: z.object({
        text: z.string().describe('要生成音频的文本'),
        voice: z
          .string()
          .optional()
          .default(defaultVoice)
          .describe('语音类型'),
        format: z
          .string()
          .optional()
          .default(defaultFormat)
          .describe('音频格式'),
        sessionId: z
          .string()
          .optional()
          .describe('会话ID（留空则使用当前会话）'),
      }),
    }
  );
}

registerTool('generate_audio', create);