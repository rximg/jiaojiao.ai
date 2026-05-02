/**
 * 智谱 TTS 适配器：同步接口（仅 endpoint），返回原始 PCM buffer（不做格式转换）
 */
import type { TTSAIConfig } from '#backend/domain/inference/types.js';
import { SyncInferenceBase } from '../../bases/sync-inference-base.js';
import { throwIfResponseNotOk } from '../../http-fetch-helpers.js';
import type { TTSPortInput } from '../../port-types.js';

const ZHIPU_PCM_SAMPLE_RATE = 24000;
const ZHIPU_PCM_CHANNELS = 1;

const ZHIPU_VOICE_MAP: Record<string, string> = {
  chinese_female: 'tongtong',
  chinese_male: 'tongtong',
  tongtong: 'tongtong',
};

export interface TtsZhipuPcmResult {
  pcmBuffer: Buffer;
  sampleRate: number;
  channels: number;
}

/** 调用智谱 TTS API，返回原始 PCM buffer；格式转换由业务层（如 services/audio-format）处理 */
export async function fetchTtsPcmZhipu(
  cfg: TTSAIConfig,
  text: string,
  voice: string
): Promise<TtsZhipuPcmResult> {
  const voiceApi = ZHIPU_VOICE_MAP[voice] ?? 'tongtong';
  const res = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      input: text,
      voice: voiceApi,
      response_format: 'pcm',
    }),
  });
  await throwIfResponseNotOk(res, 'TTS API error');
  const pcmBuffer = Buffer.from(await res.arrayBuffer());
  return {
    pcmBuffer,
    sampleRate: ZHIPU_PCM_SAMPLE_RATE,
    channels: ZHIPU_PCM_CHANNELS,
  };
}

/** 智谱 TTS 同步端口适配器 */
export class TTSZhipuPort extends SyncInferenceBase<TTSPortInput, TtsZhipuPcmResult> {
  constructor(private readonly cfg: TTSAIConfig) {
    super();
  }

  protected async _execute(input: TTSPortInput): Promise<TtsZhipuPcmResult> {
    return fetchTtsPcmZhipu(this.cfg, input.text, input.voice);
  }
}
