/**
 * Inference 层：VL 适配器，callVL 返回非空 content（集成测试调用真实 VL 接口 DashScope/智谱）
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import { getAIConfig } from '../../../backend/infrastructure/inference/ai-config.js';
import { callVLZhipu } from '../../../backend/infrastructure/inference/adapters/vl/zhipu.js';
import { callVLDashScope } from '../../../backend/infrastructure/inference/adapters/vl/dashscope.js';
import { parseVlScriptLinesFromModelContent } from '../../../backend/infrastructure/inference/vl-script-response.js';
import { loadConfig, lastLoadedConfigPath } from '../../../backend/app-config';
import type { VLAIConfig } from '#backend/domain/inference/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const testProvider =
  process.env.TEST_API_PROVIDER === 'zhipu' ||
  process.env.TEST_API_PROVIDER === 'dashscope' ||
  process.env.TEST_API_PROVIDER === 'jiaojiao'
    ? process.env.TEST_API_PROVIDER
    : undefined;
let hasKey = false;

function logKeyStatus(apiKeys: { dashscope?: string; zhipu?: string }): string {
  const ds = apiKeys.dashscope?.trim();
  const zp = apiKeys.zhipu?.trim();
  const jj = (apiKeys as { jiaojiao?: string }).jiaojiao?.trim();
  return `dashscope: ${ds ? `已配置(len=${ds.length})` : '未配置'}, zhipu: ${zp ? `已配置(len=${zp.length})` : '未配置'}, jiaojiao: ${jj ? `已配置(len=${jj.length})` : '未配置'}`;
}

function debugLog(msg: string): void {
  try {
    const fsSync = require('fs');
    const logPath = path.join(__dirname, '..', '..', '.integration-debug.log');
    fsSync.appendFileSync(logPath, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // ignore
  }
}

async function createMinimalTestPng(): Promise<Buffer> {
  return sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .png()
    .toBuffer();
}

/** 稍大图 + 高对比色块，便于 VL 产出非空台词列表 */
async function createVlScriptTestPng(): Promise<Buffer> {
  const w = 128;
  const h = 96;
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#f0f0f0"/>
    <circle cx="32" cy="48" r="20" fill="#e63946"/>
    <rect x="72" y="28" width="40" height="40" fill="#457b9d"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe('Inference / VL', () => {
  beforeAll(async () => {
    debugLog(`[VL] TEST_API_PROVIDER=${process.env.TEST_API_PROVIDER ?? '(未设置)'}`);
    try {
      const config = await loadConfig();
      const apiKeys = (config.multimodalApiKeys ?? config.apiKeys) as {
        dashscope?: string;
        zhipu?: string;
        jiaojiao?: string;
      };
      const provider = (testProvider ?? config.agent?.multimodalProvider ?? config.agent?.provider ?? 'dashscope') as
        | 'dashscope'
        | 'zhipu'
        | 'jiaojiao';
      hasKey = !!(apiKeys[provider]?.trim());
      debugLog(`[VL] 配置文件路径: ${lastLoadedConfigPath ?? '(未使用文件)'}`);
      debugLog(`[VL] config.agent.provider=${config.agent?.provider} -> 使用 provider=${provider} hasKey=${hasKey} | ${logKeyStatus(apiKeys)}`);
    } catch (err) {
      hasKey = false;
      debugLog(`[VL] 初始化失败: ${(err as Error).message}`);
    }
  });

  it('(debug) 集成测试条件与配置路径', () => {
    expect(typeof hasKey).toBe('boolean');
  });

  it('should return non-empty content from VL API (zhipu or dashscope)', async (ctx) => {
    if (!hasKey) ctx.skip();
    const cfg = (await getAIConfig('vl')) as VLAIConfig;
    const buf = await createMinimalTestPng();
    const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
    const prompt = cfg.prompt || '描述这张图片，用一句话即可。';
    const content =
      cfg.provider === 'zhipu'
        ? await callVLZhipu({ cfg, dataUrl, prompt })
        : await callVLDashScope({ cfg, dataUrl, prompt });
    expect(typeof content).toBe('string');
    expect(content.length).toBeGreaterThan(0);
  }, 60_000);

  it('dashscope qwen3.6-flash: VL 台词 JSON 可被解析（与 generate_script 一致）', async (ctx) => {
    if (!hasKey) ctx.skip();
    const base = (await getAIConfig('vl')) as VLAIConfig;
    if (base.provider !== 'dashscope') ctx.skip();
    const cfg: VLAIConfig = { ...base, model: 'qwen3.6-flash' };
    const buf = await createVlScriptTestPng();
    const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
    const prompt =
      '你是绘本台词设计师。图中有红圆与蓝方块等明显元素。' +
      '请输出恰好一个 JSON 数组（不要用 Markdown 代码块），至少 2 个对象；每个对象含非空 text 与数字坐标 x、y。' +
      '格式示例：[{"text":"红色圆形像在打招呼","x":32,"y":48},{"text":"蓝色方块稳稳站着","x":92,"y":48}]';
    const content = await callVLDashScope({ cfg, dataUrl, prompt });
    const lines = parseVlScriptLinesFromModelContent(content);
    expect(lines.length, `raw=\n${content.slice(0, 900)}`).toBeGreaterThan(0);
    expect(lines.some((l) => l.text.trim().length > 0)).toBe(true);
  }, 90_000);
});
