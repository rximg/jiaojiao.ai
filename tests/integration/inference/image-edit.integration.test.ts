/**
 * Inference 层：图片编辑适配器集成测试（DashScope / Jiaojiao qwen-image-edit-max）。
 * 直接测试提交 + 轮询真实接口。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import { getAIConfig } from '../../../backend/infrastructure/inference/ai-config.js';
import { callEditImageDashScope } from '../../../backend/infrastructure/inference/adapters/image-edit/dashscope.ts';
import { loadConfig } from '../../../backend/app-config';
import type { T2IAIConfig } from '../../../backend/domain/inference/types.js';

const testProvider =
  process.env.TEST_API_PROVIDER === 'zhipu' ||
  process.env.TEST_API_PROVIDER === 'dashscope' ||
  process.env.TEST_API_PROVIDER === 'jiaojiao'
    ? process.env.TEST_API_PROVIDER
    : undefined;

let hasKey = false;
const testTimeoutMs = process.env.TEST_API_PROVIDER === 'jiaojiao' ? 300_000 : 120_000;

async function createMinimalTestPng(): Promise<Buffer> {
  return sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .png()
    .toBuffer();
}

describe('Inference / Image Edit (DashScope/Jiaojiao)', () => {
  beforeAll(async () => {
    try {
      const config = await loadConfig();
      const provider = (testProvider ?? config.agent?.multimodalProvider ?? config.agent?.provider ?? 'dashscope') as
        | 'dashscope'
        | 'zhipu'
        | 'jiaojiao';
      const keys = (config.multimodalApiKeys ?? config.apiKeys) as Record<string, string | undefined>;
      const key = keys[provider];
      hasKey = !!key?.trim();
    } catch {
      hasKey = false;
    }
  });

  it('should return image URL from image-edit adapter', async (ctx) => {
    if (!hasKey) ctx.skip();

    const cfg = (await getAIConfig('t2i')) as T2IAIConfig;
    if (cfg.provider !== 'dashscope' && cfg.provider !== 'jiaojiao') {
      ctx.skip();
    }
    const model = cfg.provider === 'jiaojiao' ? 'qwen-image-edit-max' : (cfg.model ?? 'qwen-image-edit-max');

    const imageBuffer = await createMinimalTestPng();
    const imageDataUrl = `data:image/png;base64,${imageBuffer.toString('base64')}`;

    let result: { imageUrl: string };
    try {
      result = await callEditImageDashScope(cfg, {
        model,
        prompt: '参考图颜色与构图，生成一张简洁风格的水果插画',
        imageDataUrls: [imageDataUrl],
        parameters: {
          size: '1280*1280',
          n: 1,
          prompt_extend: true,
          watermark: false,
          enable_interleave: false,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('AccessDenied') && message.includes('does not support synchronous calls')) {
        ctx.skip();
      }
      throw error;
    }

    expect(typeof result.imageUrl).toBe('string');
    expect(result.imageUrl.startsWith('http')).toBe(true);
  }, testTimeoutMs);
});
