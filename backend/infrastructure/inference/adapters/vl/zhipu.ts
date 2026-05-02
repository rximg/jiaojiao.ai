/**
 * 智谱 VL 适配器：同步接口，仅 endpoint
 */
import type { VLAIConfig } from '#backend/domain/inference/types.js';
import { SyncInferenceBase } from '../../bases/sync-inference-base.js';
import { throwIfResponseNotOk } from '../../http-fetch-helpers.js';
import type { VLPortInput } from '../../port-types.js';

export interface CallVLParams {
  cfg: VLAIConfig;
  dataUrl: string;
  prompt: string;
}

/** 调用智谱多模态接口，返回助手回复文本（应为 JSON 数组字符串） */
export async function callVLZhipu(params: CallVLParams): Promise<string> {
  const { cfg, dataUrl, prompt } = params;
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

  const res = await fetch(chatUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  await throwIfResponseNotOk(res, 'VL API failed');

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data?.choices?.[0]?.message?.content;
  if (content == null || typeof content !== 'string') {
    throw new Error('VL API did not return message content');
  }
  return content;
}

/** 智谱 VL 同步端口适配器 */
export class VLZhipuPort extends SyncInferenceBase<VLPortInput, string> {
  constructor(private readonly cfg: VLAIConfig) {
    super();
  }

  protected async _execute(input: VLPortInput): Promise<string> {
    return callVLZhipu({ cfg: this.cfg, dataUrl: input.dataUrl, prompt: input.prompt });
  }
}
