/**
 * DashScope 图像编辑适配器：兼容两种模式并统一返回 imageUrl。
 * - `wan2.6-image`：保留万象异步提交 + 轮询
 * - `qwen-image-edit-max`：同步返回，必要时从异步自动回退到同步
 * 文档：docs/third-party-api/dashscope-api.md / docs/百炼万象2.6的图片编辑api.md
 */
import type { T2IAIConfig } from '#backend/domain/inference/types.js';
import { SyncInferenceBase } from '../../bases/sync-inference-base.js';
import type { EditImagePortInput } from '../../port-types.js';

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_ATTEMPTS = 60;

export interface DashScopeEditImageOutput {
  imageUrl: string;
}

interface DashScopeEditImageResponse {
  output?: {
    task_id?: string;
    task_status?: string;
    message?: string;
    choices?: Array<{
      message?: {
        content?: Array<{
          type?: string;
          image?: string;
        }>;
      };
    }>;
  };
  code?: string;
  message?: string;
}

function logEditImageDebug(stage: string, payload: Record<string, unknown>): void {
  if (process.env.DEBUG_IMAGE_EDIT !== '1') return;
  console.log(`[image-edit][${stage}]`, JSON.stringify(payload, null, 2));
}

function resolveEditImageEndpoint(cfg: T2IAIConfig): string {
  const trimmed = cfg.endpoint.replace(/\/$/, '');

  if (cfg.provider === 'jiaojiao') {
    return trimmed;
  }

  if (cfg.provider === 'dashscope') {
    return trimmed.replace(
      /\/api\/v1\/services\/aigc\/image-generation\/generation$/,
      '/api/v1/services/aigc/multimodal-generation/generation'
    );
  }

  return trimmed;
}

function resolveEditImageModel(cfg: T2IAIConfig, input: EditImagePortInput): string {
  return (
    input.model?.trim() ||
    (cfg.provider === 'jiaojiao'
      ? 'qwen-image-edit-max'
      : cfg.model === 'wan2.6-t2i'
        ? 'wan2.6-image'
        : cfg.model)
  );
}

function buildEditImageRequest(cfg: T2IAIConfig, input: EditImagePortInput) {
  const content = [
    { text: input.prompt },
    ...input.imageDataUrls.map((dataUrl) => ({ image: dataUrl })),
  ];

  const resolvedModel = resolveEditImageModel(cfg, input);
  const body = {
    model: resolvedModel,
    input: {
      messages: [
        {
          role: 'user' as const,
          content,
        },
      ],
    },
    parameters: {
      prompt_extend: input.parameters.prompt_extend,
      watermark: input.parameters.watermark,
      n: input.parameters.n,
      enable_interleave: input.parameters.enable_interleave,
      size: input.parameters.size,
    },
  };

  return {
    endpoint: resolveEditImageEndpoint(cfg),
    resolvedModel,
    body,
  };
}

function extractImageUrlFromResponse(data: DashScopeEditImageResponse): string | undefined {
  return data?.output?.choices?.[0]?.message?.content?.find(
    (item) => !!item?.image && (!item?.type || item.type === 'image')
  )?.image;
}

function shouldUseSyncImageEdit(resolvedModel: string): boolean {
  return /^qwen-image-edit-max(?:-|$)/.test(resolvedModel);
}

function isAsyncUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /does not support asynchronous calls/i.test(message);
}

export async function submitEditImageDashScope(
  cfg: T2IAIConfig,
  input: EditImagePortInput
): Promise<string> {
  const { endpoint, resolvedModel, body } = buildEditImageRequest(cfg, input);
  logEditImageDebug('submit', {
    provider: cfg.provider,
    endpoint,
    cfgModel: cfg.model,
    inputModel: input.model,
    resolvedModel,
    imageCount: input.imageDataUrls.length,
    parameters: body.parameters,
  });

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify(body),
  });

  logEditImageDebug('submit-response', {
    status: res.status,
    statusText: res.statusText,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Edit image submit failed: ${res.status} ${res.statusText} ${text}`);
  }

  const data = (await res.json()) as DashScopeEditImageResponse;
  if (data?.code) {
    throw new Error(`Edit image API error: ${data.code} ${data.message ?? ''}`.trim());
  }

  const taskId = data?.output?.task_id;
  if (!taskId) {
    throw new Error('Edit image submit did not return task_id');
  }
  return taskId;
}

export async function pollEditImageDashScope(
  cfg: T2IAIConfig,
  taskId: string
): Promise<DashScopeEditImageOutput> {
  const pollUrl = cfg.taskEndpoint.replace(/\/$/, '') + '/' + taskId;
  const intervalMs = cfg.poll_interval_ms ?? DEFAULT_POLL_INTERVAL_MS;
  const maxAttempts = cfg.max_poll_attempts ?? DEFAULT_MAX_ATTEMPTS;

  logEditImageDebug('poll-start', {
    provider: cfg.provider,
    pollUrl,
    taskId,
    intervalMs,
    maxAttempts,
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const res = await fetch(pollUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Edit image poll failed: ${res.status} ${res.statusText} ${text}`);
    }

    const data = (await res.json()) as DashScopeEditImageResponse;
    if (data?.code) {
      throw new Error(`Edit image API error: ${data.code} ${data.message ?? ''}`.trim());
    }

    const status = data?.output?.task_status;
    if (status === 'FAILED') {
      throw new Error(`Edit image task failed: ${data?.output?.message ?? 'Unknown error'}`);
    }

    if (status === 'SUCCEEDED') {
      const imageUrl = extractImageUrlFromResponse(data);
      if (!imageUrl) {
        throw new Error('Edit image task succeeded but no output image URL returned');
      }
      return { imageUrl };
    }
  }

  throw new Error(`Edit image task timeout after ${maxAttempts} attempts`);
}

async function callEditImageDashScopeSync(
  cfg: T2IAIConfig,
  input: EditImagePortInput
): Promise<DashScopeEditImageOutput> {
  const { endpoint, resolvedModel, body } = buildEditImageRequest(cfg, input);

  logEditImageDebug('submit-sync', {
    provider: cfg.provider,
    endpoint,
    cfgModel: cfg.model,
    inputModel: input.model,
    resolvedModel,
    imageCount: input.imageDataUrls.length,
    parameters: body.parameters,
  });

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  logEditImageDebug('submit-sync-response', {
    status: res.status,
    statusText: res.statusText,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Edit image sync call failed: ${res.status} ${res.statusText} ${text}`);
  }

  const data = (await res.json()) as DashScopeEditImageResponse;
  logEditImageDebug('submit-sync-json', { data });
  if (data?.code) {
    throw new Error(`Edit image API error: ${data.code} ${data.message ?? ''}`.trim());
  }

  const imageUrl = extractImageUrlFromResponse(data);
  if (!imageUrl) {
    throw new Error('Edit image sync call did not return output image URL');
  }

  return { imageUrl };
}

export async function callEditImageDashScope(
  cfg: T2IAIConfig,
  input: EditImagePortInput
): Promise<DashScopeEditImageOutput> {
  const resolvedModel = resolveEditImageModel(cfg, input);
  if (shouldUseSyncImageEdit(resolvedModel)) {
    return callEditImageDashScopeSync(cfg, input);
  }

  try {
    const taskId = await submitEditImageDashScope(cfg, input);
    return pollEditImageDashScope(cfg, taskId);
  } catch (error) {
    if (isAsyncUnsupportedError(error)) {
      logEditImageDebug('sync-fallback', {
        provider: cfg.provider,
        cfgModel: cfg.model,
        inputModel: input.model,
        resolvedModel,
        reason: error instanceof Error ? error.message : String(error),
      });
      return callEditImageDashScopeSync(cfg, input);
    }
    throw error;
  }
}

export class EditImageDashScopePort extends SyncInferenceBase<EditImagePortInput, DashScopeEditImageOutput> {
  constructor(private readonly cfg: T2IAIConfig) {
    super();
  }

  protected async _execute(input: EditImagePortInput): Promise<DashScopeEditImageOutput> {
    return callEditImageDashScope(this.cfg, input);
  }
}
