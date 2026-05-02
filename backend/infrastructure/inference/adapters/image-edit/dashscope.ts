/**
 * DashScope 图像编辑适配器：兼容两种模式并统一返回 imageUrl。
 * - 同步 / 异步由 `ImageEditAIConfig.submitModeByModelId` 决定（来自 ai_models.json `models[].submit_mode`，缺省 sync）
 * - 异步：`X-DashScope-Async` + `task_id` + 轮询；若上游拒绝异步可回退同步
 * 文档：docs/third-party-api/dashscope-api.md / docs/百炼万象2.6的图片编辑api.md
 */
import type { ImageEditAIConfig } from '#backend/domain/inference/types.js';
import { SyncInferenceBase } from '../../bases/sync-inference-base.js';
import { extractFirstImageUrlFromDashScopeChoicesRoot } from '../../dashscope-multimodal-image-url.js';
import { throwIfResponseNotOk } from '../../http-fetch-helpers.js';
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

function resolveEditImageEndpoint(cfg: ImageEditAIConfig): string {
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

function resolveEditImageModel(cfg: ImageEditAIConfig, input: EditImagePortInput): string {
  const explicit = input.model?.trim();
  if (explicit) return explicit;
  return cfg.model === 'wan2.6-t2i' ? 'wan2.6-image' : cfg.model;
}

function buildEditImageRequest(cfg: ImageEditAIConfig, input: EditImagePortInput) {
  const limitedImageDataUrls = input.imageDataUrls.slice(0, 3);
  const content = [
    { text: input.prompt },
    ...limitedImageDataUrls.map((dataUrl) => ({ image: dataUrl })),
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

function resolveImageEditSubmitModeFromCfg(
  cfg: ImageEditAIConfig,
  effectiveModelId: string
): 'sync' | 'async' {
  return cfg.submitModeByModelId[effectiveModelId] === 'async' ? 'async' : 'sync';
}

function isAsyncUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /does not support asynchronous calls/i.test(message);
}

function throwIfDashScopeEditImageApiCode(data: DashScopeEditImageResponse): void {
  if (data?.code) {
    throw new Error(`Edit image API error: ${data.code} ${data.message ?? ''}`.trim());
  }
}

type EditImagePostDebugStages = {
  request: string;
  response: string;
  /** 同步路径解析后打全量 JSON；异步 submit 不传 */
  json?: string;
  httpErrorLabel: string;
};

/** POST multimodal-generation + HTTP 校验 + `code` 字段校验（async 仅多 `X-DashScope-Async`） */
async function postEditImageDashScopeParsed(
  cfg: ImageEditAIConfig,
  endpoint: string,
  body: ReturnType<typeof buildEditImageRequest>['body'],
  asyncMode: boolean,
  stages: EditImagePostDebugStages,
  requestLogPayload: Record<string, unknown>
): Promise<DashScopeEditImageResponse> {
  logEditImageDebug(stages.request, requestLogPayload);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.apiKey}`,
  };
  if (asyncMode) {
    headers['X-DashScope-Async'] = 'enable';
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  logEditImageDebug(stages.response, {
    status: res.status,
    statusText: res.statusText,
  });

  await throwIfResponseNotOk(res, stages.httpErrorLabel);

  const data = (await res.json()) as DashScopeEditImageResponse;
  if (stages.json) {
    logEditImageDebug(stages.json, { data });
  }
  throwIfDashScopeEditImageApiCode(data);
  return data;
}

export async function submitEditImageDashScope(
  cfg: ImageEditAIConfig,
  input: EditImagePortInput
): Promise<string> {
  const { endpoint, resolvedModel, body } = buildEditImageRequest(cfg, input);
  const data = await postEditImageDashScopeParsed(
    cfg,
    endpoint,
    body,
    true,
    {
      request: 'submit',
      response: 'submit-response',
      httpErrorLabel: 'Edit image submit failed',
    },
    {
      provider: cfg.provider,
      endpoint,
      cfgModel: cfg.model,
      inputModel: input.model,
      resolvedModel,
      imageCount: input.imageDataUrls.length,
      parameters: body.parameters,
    }
  );

  const taskId = data?.output?.task_id;
  if (!taskId) {
    throw new Error('Edit image submit did not return task_id');
  }
  return taskId;
}

export async function pollEditImageDashScope(
  cfg: ImageEditAIConfig,
  taskId: string
): Promise<DashScopeEditImageOutput> {
  const taskEp = cfg.taskEndpoint?.replace(/\/$/, '');
  if (!taskEp) throw new Error('Edit image poll requires taskEndpoint in config');
  const pollUrl = `${taskEp}/${taskId}`;
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

    await throwIfResponseNotOk(res, 'Edit image poll failed');

    const data = (await res.json()) as DashScopeEditImageResponse;
    throwIfDashScopeEditImageApiCode(data);

    const status = data?.output?.task_status;
    if (status === 'FAILED') {
      throw new Error(`Edit image task failed: ${data?.output?.message ?? 'Unknown error'}`);
    }

    if (status === 'SUCCEEDED') {
      const imageUrl = extractFirstImageUrlFromDashScopeChoicesRoot(data);
      if (!imageUrl) {
        throw new Error('Edit image task succeeded but no output image URL returned');
      }
      return { imageUrl };
    }
  }

  throw new Error(`Edit image task timeout after ${maxAttempts} attempts`);
}

async function callEditImageDashScopeSync(
  cfg: ImageEditAIConfig,
  input: EditImagePortInput
): Promise<DashScopeEditImageOutput> {
  const { endpoint, resolvedModel, body } = buildEditImageRequest(cfg, input);
  const data = await postEditImageDashScopeParsed(
    cfg,
    endpoint,
    body,
    false,
    {
      request: 'submit-sync',
      response: 'submit-sync-response',
      json: 'submit-sync-json',
      httpErrorLabel: 'Edit image sync call failed',
    },
    {
      provider: cfg.provider,
      endpoint,
      cfgModel: cfg.model,
      inputModel: input.model,
      resolvedModel,
      imageCount: input.imageDataUrls.length,
      parameters: body.parameters,
    }
  );

  const imageUrl = extractFirstImageUrlFromDashScopeChoicesRoot(data);
  if (!imageUrl) {
    throw new Error('Edit image sync call did not return output image URL');
  }

  return { imageUrl };
}

export async function callEditImageDashScope(
  cfg: ImageEditAIConfig,
  input: EditImagePortInput
): Promise<DashScopeEditImageOutput> {
  const resolvedModel = resolveEditImageModel(cfg, input);
  if (resolveImageEditSubmitModeFromCfg(cfg, resolvedModel) === 'sync') {
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
  constructor(private readonly cfg: ImageEditAIConfig) {
    super();
  }

  protected async _execute(input: EditImagePortInput): Promise<DashScopeEditImageOutput> {
    return callEditImageDashScope(this.cfg, input);
  }
}
