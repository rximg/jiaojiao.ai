/**
 * 通义 TTS 适配器：同步接口（单次 POST 返回 output.audio.url，再 GET 下载音频）
 * 文档：https://help.aliyun.com/zh/model-studio/qwen-tts-api
 * 地址：https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
 */
import type { TTSAIConfig } from '#backend/domain/inference/types.js';
import { SyncInferenceBase } from '../../bases/sync-inference-base.js';
import { throwIfResponseNotOk } from '../../http-fetch-helpers.js';
import type { TTSPortInput } from '../../port-types.js';

const VOICE_MAP: Record<string, string> = {
  chinese_female: 'Cherry',
  chinese_male: 'Ethan',
  english_female: 'Serena',
  english_male: 'Chelsie',
  Cherry: 'Cherry',
  Ethan: 'Ethan',
  Serena: 'Serena',
  Chelsie: 'Chelsie',
};

export interface TtsDashScopeResult {
  audioUrl: string;
}

/** 同步调用通义 TTS：POST 返回 JSON 中含 output.audio.url，再 GET 该 URL 下载由调用方完成 */
export async function fetchTtsAudioUrlDashScope(
  cfg: TTSAIConfig,
  text: string,
  voice: string
): Promise<TtsDashScopeResult> {
  const voiceApi = VOICE_MAP[voice] || 'Cherry';
  const response = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      input: {
        text,
        voice: voiceApi,
        language_type: 'Chinese',
      },
    }),
  });
  await throwIfResponseNotOk(response, 'TTS API error');
  const data = (await response.json()) as {
    output?: { audio?: { url?: string }; id?: string; expires_at?: number };
  };
  const audioUrl = data?.output?.audio?.url;
  if (!audioUrl) {
    throw new Error('TTS API did not return output.audio.url');
  }
  return { audioUrl };
}

/** 通义 TTS 同步端口适配器（仅 endpoint，无 taskEndpoint） */
export class TTSDashScopePort extends SyncInferenceBase<TTSPortInput, TtsDashScopeResult> {
  constructor(private readonly cfg: TTSAIConfig) {
    super();
  }

  protected async _execute(input: TTSPortInput): Promise<TtsDashScopeResult> {
    return fetchTtsAudioUrlDashScope(this.cfg, input.text, input.voice);
  }
}
