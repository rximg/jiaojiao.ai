/**
 * 智谱 T2I 适配器：异步接口（endpoint 提交 + taskEndpoint 轮询），返回 imageUrl
 */
import type { T2IAIConfig } from '#backend/domain/inference/types.js';
import { AsyncInferenceBase } from '../../bases/async-inference-base.js';
import { throwIfResponseNotOk } from '../../http-fetch-helpers.js';
import type { T2IPortInput } from '../../port-types.js';

const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_MAX_ATTEMPTS = 60;

export async function submitTaskZhipu(
  cfg: T2IAIConfig,
  prompt: string,
  parameters: { size?: string; quality?: string; negative_prompt?: string }
): Promise<string> {
  const size = parameters.size ?? '1280x1280';
  const body: Record<string, unknown> = {
    model: cfg.model,
    prompt,
    size: size.includes('*') ? size.replace('*', 'x') : size,
    quality: parameters.quality ?? 'hd',
    watermark_enabled: false,
  };
  if (parameters.negative_prompt?.trim()) {
    body.negative_prompt = parameters.negative_prompt.trim();
  }
  const res = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body as Record<string, unknown>),
  });
  await throwIfResponseNotOk(res, 'T2I submit failed');
  const data = (await res.json()) as { id?: string };
  const taskId = data?.id;
  if (!taskId) throw new Error('T2I submit did not return task id');
  return taskId;
}

export async function pollForImageUrlZhipu(cfg: T2IAIConfig, taskId: string): Promise<string> {
  const url = cfg.taskEndpoint.replace(/\/$/, '') + '/' + taskId;
  const intervalMs = cfg.poll_interval_ms ?? DEFAULT_POLL_INTERVAL_MS;
  const maxAttempts = cfg.max_poll_attempts ?? DEFAULT_MAX_ATTEMPTS;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    await throwIfResponseNotOk(res, 'T2I poll failed');
    const taskData = (await res.json()) as {
      task_status?: string;
      image_result?: Array<{ url?: string }>;
      result?: { images?: Array<{ url?: string }>; data?: Array<{ url?: string }> };
      data?: Array<{ url?: string }>;
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    const status = taskData?.task_status;
    if (status === 'FAIL') {
      const msg = taskData?.error?.message ?? 'Unknown error';
      throw new Error(`T2I task failed: ${msg}`);
    }
    const url0 = taskData?.image_result?.[0]?.url;
    if (url0) return url0;
    if (status === 'SUCCESS') {
      throw new Error(
        'T2I task succeeded but no image URL in response. Response keys: ' +
          Object.keys(taskData).join(', ')
      );
    }
  }
  throw new Error(`T2I task timeout after ${maxAttempts} attempts`);
}

/** 智谱 T2I 异步端口适配器 */
export class T2IZhipuPort extends AsyncInferenceBase<T2IPortInput, string, string> {
  constructor(private readonly cfg: T2IAIConfig) {
    super();
  }

  protected async _submit(input: T2IPortInput): Promise<string> {
    const params = {
      size: (input.parameters.size as string) ?? '1280x1280',
      quality: (input.parameters.quality as string) ?? 'hd',
      negative_prompt: input.parameters.negative_prompt as string | undefined,
    };
    return submitTaskZhipu(this.cfg, input.prompt, params);
  }

  protected async _poll(taskId: string): Promise<string> {
    return pollForImageUrlZhipu(this.cfg, taskId);
  }
}
