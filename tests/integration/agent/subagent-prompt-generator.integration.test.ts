/**
 * SubAgent（prompt_generator）：createAgent + FilesystemMiddleware 路径会触发 LangChain 对工具 schema 的 Zod 互操作。
 * 若在 Electron 打包中出现多份 Zod，会报：Schema must be an instance of z3.ZodObject or z4.$ZodObject
 *
 * 无 API Key 时跳过（需真实 LLM 才会调用 write_file）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { AgentFactory } from '../../../backend/agent/AgentFactory.js';
import { initializeServices } from '../../../backend/services/service-initializer.js';
import { loadConfig } from '../../../backend/app-config.js';
import { getWorkspaceFilesystem } from '../../../backend/services/fs.js';

let hasLlmKey = false;

describe('Agent / SubAgent prompt_generator (Zod tool path)', () => {
  beforeAll(async () => {
    await initializeServices({ outputPath: './outputs' });
    try {
      const config = await loadConfig();
      const provider = (config.agent?.provider ?? 'dashscope') as 'dashscope' | 'zhipu';
      const keys = config.apiKeys as Record<string, string> | undefined;
      hasLlmKey = !!(keys?.[provider]?.trim());
    } catch {
      hasLlmKey = false;
    }
  });

  it('createSubAgent(prompt_generator) 应返回带 invoke 的 runnable', async () => {
    process.env.AGENT_CASE_ID = 'encyclopedia';
    const factory = new AgentFactory();
    const sessionId = `subagent-smoke-${Date.now()}`;
    const raw = await factory.createSubAgent('prompt_generator', sessionId, true);
    expect(raw).toBeDefined();
    expect(typeof (raw as { invoke?: unknown }).invoke).toBe('function');
  }, 60_000);

  it('invoke 子代理不应触发 Zod schema 互操作错误（需 API Key）', async (ctx) => {
    if (!hasLlmKey) ctx.skip();

    process.env.AGENT_CASE_ID = 'encyclopedia';
    const sessionId = `subagent-zod-${Date.now()}`;
    const factory = new AgentFactory();
    const runnable = await factory.createSubAgent('prompt_generator', sessionId, true);
    expect(typeof (runnable as { invoke: (i: unknown, c?: unknown) => Promise<unknown> }).invoke).toBe('function');

    const input = {
      messages: [
        {
          role: 'user' as const,
          content:
            '请为 3 岁儿童生成「老虎」科普绘本的文生图提示词（卡通风格），生成后务必调用 write_file 保存到 image_prompt.txt，内容可简短占位。',
        },
      ],
    };
    const config = { configurable: { thread_id: sessionId } };

    const result = await (runnable as { invoke: (i: unknown, c?: unknown) => Promise<unknown> }).invoke(
      input,
      config
    );
    expect(result).toBeDefined();
    const messages = (result as { messages?: unknown[] })?.messages;
    expect(Array.isArray(messages)).toBe(true);
    expect((messages as unknown[]).length).toBeGreaterThan(0);

    const workspaceFs = getWorkspaceFilesystem();
    const content = await workspaceFs.readFile(sessionId, 'image_prompt.txt', 'utf-8');
    expect(typeof content).toBe('string');
    expect((content as string).length).toBeGreaterThan(0);
  }, 180_000);
});
