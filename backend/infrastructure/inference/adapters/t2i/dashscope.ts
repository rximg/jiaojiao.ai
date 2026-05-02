/**
 * 通义 T2I 适配器：异步接口（endpoint 提交 + taskEndpoint 轮询），返回 imageUrl
 */
import type { T2IAIConfig } from '#backend/domain/inference/types.js';
import { AsyncInferenceBase } from '../../bases/async-inference-base.js';
import { throwIfResponseNotOk } from '../../http-fetch-helpers.js';
import type { T2IPortInput } from '../../port-types.js';

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_ATTEMPTS = 60;

function isQwenImageModel(model: string): boolean {
  return /^qwen-image(?:-|$)/.test(model) || /^qwen-image-2\.0(?:-|$)/.test(model);
}

function isWanT2IModel(model: string): boolean {
  return /^wan2\.6-t2i(?:-|$)/.test(model);
}

function encodeSyncImageUrlAsTaskId(imageUrl: string): string {
  return `__sync_image_url__:${imageUrl}`;
}

function decodeSyncImageUrlFromTaskId(taskId: string): string | undefined {
  if (!taskId.startsWith('__sync_image_url__:')) return undefined;
  return taskId.slice('__sync_image_url__:'.length);
}

function extractFirstImageUrlFromContent(
  content: Array<{ type?: string; image?: string }> | undefined
): string | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const item of content) {
    if (item?.image && (!item?.type || item.type === 'image')) return item.image;
  }
  return undefined;
}

export async function submitTaskDashScope(
  cfg: T2IAIConfig,
  prompt: string,
  parameters: Record<string, unknown>
): Promise<string> {
  const body = {
    model: cfg.model,
    input: {
      messages: [{ role: 'user' as const, content: [{ text: prompt }] }],
    },
    parameters,
  };
  const model = cfg.model ?? '';
  const useSyncMultimodal = isQwenImageModel(model);
  const submitUrl =
    !useSyncMultimodal && isWanT2IModel(model) && cfg.legacyEndpoint ? cfg.legacyEndpoint : cfg.endpoint;

  const res = await fetch(submitUrl, {
    method: 'POST',
    headers: useSyncMultimodal
      ? {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        }
      : {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
          'X-DashScope-Async': 'enable',
        },
    body: JSON.stringify(body),
  });
  await throwIfResponseNotOk(res, 'T2I submit failed');
  const data = (await res.json()) as {
    output?: {
      task_id?: string;
      choices?: Array<{ message?: { content?: Array<{ type?: string; image?: string }> } }>;
    };
  };

  if (useSyncMultimodal) {
    const imageUrl = extractFirstImageUrlFromContent(data?.output?.choices?.[0]?.message?.content);
    if (!imageUrl) throw new Error('T2I sync call succeeded but no image URL in response');
    return encodeSyncImageUrlAsTaskId(imageUrl);
  }

  const taskId = data?.output?.task_id;
  if (!taskId) throw new Error('T2I submit did not return task_id');
  return taskId;
}

export async function pollForImageUrlDashScope(
  cfg: T2IAIConfig,
  taskId: string
): Promise<string> {
  const syncImageUrl = decodeSyncImageUrlFromTaskId(taskId);
  if (syncImageUrl) return syncImageUrl;

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
      output?: {
        task_status?: string;
        message?: string;
        choices?: Array<{ message?: { content?: Array<{ type?: string; image?: string }> } }>;
      };
    };
    const status = taskData?.output?.task_status;
    if (status === 'FAILED') {
      const msg = taskData?.output?.message ?? 'Unknown error';
      throw new Error(`T2I task failed: ${msg}`);
    }
    if (status === 'SUCCEEDED') {
      const imageUrl = extractFirstImageUrlFromContent(taskData?.output?.choices?.[0]?.message?.content);
      if (imageUrl) return imageUrl;
      throw new Error('T2I task succeeded but no image URL in response');
    }
  }
  throw new Error(`T2I task timeout after ${maxAttempts} attempts`);
}

/** 通义 T2I 异步端口适配器 */
export class T2IDashScopePort extends AsyncInferenceBase<T2IPortInput, string, string> {
  constructor(private readonly cfg: T2IAIConfig) {
    super();
  }

  protected async _submit(input: T2IPortInput): Promise<string> {
    return submitTaskDashScope(this.cfg, input.prompt, input.parameters);
  }

  protected async _poll(taskId: string): Promise<string> {
    return pollForImageUrlDashScope(this.cfg, taskId);
  }
}
