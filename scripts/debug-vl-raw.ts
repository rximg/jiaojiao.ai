/**
 * 单独打一次 DashScope（或其它 VL 配置）的 chat/completions，打印 HTTP 原始 body 与 message 结构。
 *
 * 用法（在项目根目录）：
 *   npx tsx --tsconfig tsconfig.json scripts/debug-vl-raw.ts
 *   npx tsx --tsconfig tsconfig.json scripts/debug-vl-raw.ts "C:\path\to\image.png"
 *
 * 环境变量（可选）：
 *   VL_DEBUG_MODEL   覆盖 ai_models 中的 VL 模型 id，默认 qwen3.6-flash
 *   VL_DEBUG_PROMPT  覆盖发给模型的文本 prompt
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { loadConfig } from '../backend/app-config.js';
import { getAIConfig } from '../backend/infrastructure/inference/ai-config.js';
import type { VLAIConfig } from '../backend/domain/inference/types.js';

async function buildDataUrl(imagePathArg: string | undefined): Promise<string> {
  if (imagePathArg?.trim()) {
    const p = path.resolve(imagePathArg.trim());
    const buf = await fs.readFile(p);
    const ext = path.extname(p).toLowerCase();
    const mime =
      ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  }
  const buf = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 100, g: 150, b: 200 } },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${buf.toString('base64')}`;
}

async function main(): Promise<void> {
  await loadConfig();
  const base = (await getAIConfig('vl')) as VLAIConfig;
  const model = process.env.VL_DEBUG_MODEL?.trim() || 'qwen3.6-flash';
  const cfg: VLAIConfig = { ...base, model };

  const dataUrl = await buildDataUrl(process.argv[2]);
  const prompt =
    process.env.VL_DEBUG_PROMPT?.trim() ||
    '请只输出一个 JSON 数组（不要 Markdown、不要说明），格式 [{"text":"一句","x":10,"y":20}]，描述图中最显眼的颜色或形状。';

  const chatUrl = cfg.endpoint.replace(/\/$/, '') + '/chat/completions';
  const body = {
    model: cfg.model,
    messages: [
      {
        role: 'user' as const,
        content: [
          { type: 'image_url' as const, image_url: { url: dataUrl } },
          { type: 'text' as const, text: prompt },
        ],
      },
    ],
  };

  console.log('=== Request ===');
  console.log('endpoint:', chatUrl);
  console.log('model:', cfg.model);
  console.log('provider:', cfg.provider);
  console.log('image:', process.argv[2] ?? '(内置 64x64 色块 PNG)');
  console.log('dataUrl length:', dataUrl.length);

  const res = await fetch(chatUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();

  console.log('\n=== HTTP ===');
  console.log('status:', res.status, res.statusText);

  console.log('\n=== Raw response body（整段字符串，与 HTTP 一致）===');
  console.log(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.log('\n(body 不是合法 JSON，上面已是全部原始输出)');
    return;
  }

  console.log('\n=== JSON.parse 后（pretty）===');
  console.log(JSON.stringify(parsed, null, 2));

  const root = parsed as {
    choices?: Array<{
      message?: Record<string, unknown>;
      finish_reason?: string;
    }>;
    error?: { message?: string; type?: string };
  };

  if (root.error) {
    console.log('\n=== API error 字段 ===');
    console.log(root.error);
    return;
  }

  const choice0 = root.choices?.[0];
  console.log('\n=== choices[0]（含 message 全部键）===');
  console.log(JSON.stringify(choice0, null, 2));

  const msg = choice0?.message;
  const content = msg?.content;
  console.log('\n=== message.content 类型与长度 ===');
  console.log(typeof content, content != null ? `length=${String(content).length}` : '');

  console.log('\n=== message.content 原始字符串（全文）===');
  console.log(content ?? '(null/undefined)');

  if (msg && typeof msg === 'object') {
    console.log('\n=== message 对象除 content 外的其它键（若有 reasoning 等会在这里）===');
    console.log(Object.keys(msg));
    for (const k of Object.keys(msg)) {
      if (k === 'content') continue;
      const v = msg[k];
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      console.log(`--- message.${k} (前 2000 字符) ---`);
      console.log(s.length > 2000 ? `${s.slice(0, 2000)}…(truncated)` : s);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
