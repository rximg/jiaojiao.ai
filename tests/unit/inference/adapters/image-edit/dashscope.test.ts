import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callEditImageDashScope,
  EditImageDashScopePort,
  submitEditImageDashScope,
  pollEditImageDashScope,
} from '../../../../../backend/infrastructure/inference/adapters/image-edit/dashscope.ts';
import type { T2IAIConfig } from '../../../../../backend/domain/inference/types.ts';
import type { EditImagePortInput } from '../../../../../backend/infrastructure/inference/port-types.ts';

const cfg: T2IAIConfig = {
  provider: 'dashscope',
  apiKey: 'test-api-key',
  endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation',
  taskEndpoint: 'https://dashscope.aliyuncs.com/api/v1/tasks',
  model: 'wan2.6-image',
};

const input: EditImagePortInput = {
  prompt: '参考图1的风格和图2的背景，生成番茄炒蛋',
  imageDataUrls: ['data:image/png;base64,AAA', 'data:image/png;base64,BBB'],
  parameters: {
    size: '1280*1280',
    n: 1,
    prompt_extend: true,
    watermark: false,
    enable_interleave: false,
  },
};

describe('image-edit/dashscope adapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('submits async task with expected headers and payload', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          output: {
            task_id: 'task-123',
          },
        }),
      } as Response);

    const result = await submitEditImageDashScope(cfg, input);

    expect(result).toBe('task-123');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
      'X-DashScope-Async': 'enable',
    });

    const body = JSON.parse(String(init.body));
    expect(body.model).toBe(cfg.model);
    expect(body.input.messages[0].role).toBe('user');
    expect(body.input.messages[0].content[0]).toEqual({ text: input.prompt });
    expect(body.input.messages[0].content[1]).toEqual({ image: input.imageDataUrls[0] });
    expect(body.input.messages[0].content[2]).toEqual({ image: input.imageDataUrls[1] });
    expect(body.parameters).toEqual({
      prompt_extend: true,
      watermark: false,
      n: 1,
      enable_interleave: false,
      size: '1280*1280',
    });
  });

  it('polls task and returns imageUrl when succeeded', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        output: {
          task_status: 'SUCCEEDED',
          choices: [
            {
              message: {
                content: [{ type: 'image', image: 'https://example.com/result.png' }],
              },
            },
          ],
        },
      }),
    } as Response);

    const result = await pollEditImageDashScope(
      { ...cfg, poll_interval_ms: 0, max_poll_attempts: 1 },
      'task-123'
    );
    expect(result).toEqual({ imageUrl: 'https://example.com/result.png' });
  });

  it('callEditImageDashScope runs submit then poll', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: { task_id: 'task-123' },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: {
            task_status: 'SUCCEEDED',
            choices: [
              {
                message: {
                  content: [{ type: 'image', image: 'https://example.com/final.png' }],
                },
              },
            ],
          },
        }),
      } as Response);

    const result = await callEditImageDashScope(
      { ...cfg, poll_interval_ms: 0, max_poll_attempts: 1 },
      input
    );

    expect(result).toEqual({ imageUrl: 'https://example.com/final.png' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(`${cfg.taskEndpoint}/task-123`);
  });

  it('falls back to sync call when async is not supported', async () => {
    const syncImageUrl = 'https://example.com/sync-result.png';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () =>
          JSON.stringify({
            code: 'AccessDenied',
            message: 'current user api does not support asynchronous calls',
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: {
            choices: [
              {
                message: {
                  content: [{ type: 'image', image: syncImageUrl }],
                },
              },
            ],
          },
        }),
      } as Response);

    const result = await callEditImageDashScope(
      { ...cfg, model: 'custom-image-edit', poll_interval_ms: 0, max_poll_attempts: 1 },
      { ...input, model: 'custom-image-edit' }
    );

    expect(result).toEqual({ imageUrl: syncImageUrl });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(firstInit.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
      'X-DashScope-Async': 'enable',
    });

    const secondInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(secondInit.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    });
  });

  it('limits image content items to first 3 reference images', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          output: {
            task_id: 'task-123',
          },
        }),
      } as Response);

    await submitEditImageDashScope(cfg, {
      ...input,
      imageDataUrls: [
        'data:image/png;base64,AAA',
        'data:image/png;base64,BBB',
        'data:image/png;base64,CCC',
        'data:image/png;base64,DDD',
      ],
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    const imageItems = body.input.messages[0].content.filter((item: { image?: string }) => !!item.image);

    expect(imageItems).toHaveLength(3);
    expect(imageItems.map((item: { image: string }) => item.image)).toEqual([
      'data:image/png;base64,AAA',
      'data:image/png;base64,BBB',
      'data:image/png;base64,CCC',
    ]);
  });

  it('throws when submit http response is not ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'invalid key',
    } as Response);

    await expect(submitEditImageDashScope(cfg, input)).rejects.toThrow(
      'Edit image submit failed: 401 Unauthorized invalid key'
    );
  });

  it('throws when submit response misses task_id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        output: {},
      }),
    } as Response);

    await expect(submitEditImageDashScope(cfg, input)).rejects.toThrow(
      'Edit image submit did not return task_id'
    );
  });

  it('throws when poll returns FAILED status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        output: {
          task_status: 'FAILED',
          message: 'quota exceeded',
        },
      }),
    } as Response);

    await expect(
      pollEditImageDashScope({ ...cfg, poll_interval_ms: 0, max_poll_attempts: 1 }, 'task-123')
    ).rejects.toThrow('Edit image task failed: quota exceeded');
  });

  it('throws when poll succeeds but has no image url', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        output: {
          task_status: 'SUCCEEDED',
          choices: [
            {
              message: {
                content: [{ type: 'text', text: 'ok' }],
              },
            },
          ],
        },
      }),
    } as Response);

    await expect(
      pollEditImageDashScope({ ...cfg, poll_interval_ms: 0, max_poll_attempts: 1 }, 'task-123')
    ).rejects.toThrow('Edit image task succeeded but no output image URL returned');
  });

  it('throws timeout when poll never reaches SUCCEEDED', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        output: {
          task_status: 'RUNNING',
        },
      }),
    } as Response);

    await expect(
      pollEditImageDashScope({ ...cfg, poll_interval_ms: 0, max_poll_attempts: 2 }, 'task-123')
    ).rejects.toThrow('Edit image task timeout after 2 attempts');
  });

  it('throws on business error code in submit response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 'InvalidParameter',
        message: 'num_images_per_prompt must be 1',
      }),
    } as Response);

    await expect(submitEditImageDashScope(cfg, input)).rejects.toThrow(
      'Edit image API error: InvalidParameter num_images_per_prompt must be 1'
    );
  });

  it('EditImageDashScopePort delegates to call function and returns imageUrl', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: { task_id: 'task-123' },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: {
            task_status: 'SUCCEEDED',
            choices: [
              {
                message: {
                  content: [{ type: 'image', image: 'https://example.com/port-result.png' }],
                },
              },
            ],
          },
        }),
      } as Response);

    const port = new EditImageDashScopePort({ ...cfg, poll_interval_ms: 0, max_poll_attempts: 1 });
    const result = await port.execute(input);

    expect(result).toEqual({ imageUrl: 'https://example.com/port-result.png' });
  });

  it('uses the jiaojiao image-edit route for jiaojiao provider', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          output: {
            task_id: 'task-123',
          },
        }),
      } as Response);

    await submitEditImageDashScope(
      {
        ...cfg,
        provider: 'jiaojiao',
        endpoint: 'http://localhost:9021/api/v1/services/aigc/image-generation/generation',
      },
      input
    );

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:9021/api/v1/services/aigc/image-generation/generation');
  });
});
