/**
 * DashScope / 智谱 VL：OpenAI 兼容 `/chat/completions` + 图文 user message（两厂商请求体相同）
 */
import type { VLAIConfig } from '#backend/domain/inference/types.js';
import { throwIfResponseNotOk } from '../../http-fetch-helpers.js';

export interface VlChatCompletionsParams {
  cfg: VLAIConfig;
  dataUrl: string;
  prompt: string;
}

/** POST chat/completions，返回 choices[0].message.content 字符串 */
export async function fetchVlChatCompletionsContent(params: VlChatCompletionsParams): Promise<string> {
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
