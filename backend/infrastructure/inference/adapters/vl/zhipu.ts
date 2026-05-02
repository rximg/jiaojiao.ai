/**
 * 智谱 VL 适配器：同步接口，仅 endpoint
 */
import type { VLAIConfig } from '#backend/domain/inference/types.js';
import { SyncInferenceBase } from '../../bases/sync-inference-base.js';
import { fetchVlChatCompletionsContent, type VlChatCompletionsParams } from '../openai-compatible/vl-chat-completions.js';
import type { VLPortInput } from '../../port-types.js';

export type CallVLParams = VlChatCompletionsParams;

export async function callVLZhipu(params: CallVLParams): Promise<string> {
  return fetchVlChatCompletionsContent(params);
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
