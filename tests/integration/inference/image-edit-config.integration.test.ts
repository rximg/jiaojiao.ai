/**
 * Inference 层：getAIConfig 支持 image_edit 能力块
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAIConfig } from '../../../backend/infrastructure/inference/ai-config.js';
import type { ImageEditAIConfig } from '../../../backend/domain/inference/types.js';

vi.mock('../../../backend/app-config.js', () => ({ loadConfig: vi.fn() }));

async function getLoadConfig() {
  const { loadConfig } = await import('../../../backend/app-config.js');
  return loadConfig as ReturnType<typeof vi.fn>;
}

describe('Inference / getAIConfig / image_edit', () => {
  beforeEach(async () => {
    const loadConfig = await getLoadConfig();
    loadConfig.mockResolvedValue({
      apiKeys: { dashscope: 'sk-dashscope', zhipu: 'sk-zhipu' },
      multimodalApiKeys: { dashscope: 'sk-dashscope', zhipu: 'sk-zhipu' },
      agent: {
        model: 'qwen-plus-2025-12-01',
        temperature: 0.1,
        maxTokens: 20000,
        provider: 'dashscope',
        multimodalProvider: 'dashscope',
      },
      storage: { outputPath: './outputs', ttsStartNumber: 6000 },
      ui: { theme: 'light', language: 'zh' },
    });
  });

  afterEach(() => {
    delete process.env.TEST_API_PROVIDER;
  });

  it('returns image_edit config with endpoint', async () => {
    const cfg = (await getAIConfig('image_edit')) as ImageEditAIConfig;
    expect(cfg.provider).toBeDefined();
    expect(cfg.endpoint).toBeDefined();
    expect(cfg.model).toBeDefined();
    expect(cfg.submitModeByModelId).toBeDefined();
    expect(cfg.submitModeByModelId['wan2.6-image']).toBe('async');
    expect(cfg.submitModeByModelId['qwen-image-edit']).toBe('sync');
  });
});

