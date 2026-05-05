/**
 * Run 作用域上下文：供流式 run 内批量工具获取 threadId、messageId、toolCallId 与进度回调。
 * 同时使用 AsyncLocalStorage 与模块级 currentRunContext，因 LangGraph 工具可能在另一 async 上下文中执行，ALS 会丢失。
 */
import { AsyncLocalStorage } from 'async_hooks';

import type { BatchProgress } from '../../tools/types.js';

export interface RunContext {
  threadId: string;
  onTokenUsage?: (
    threadId: string,
    messageId: string | undefined,
    completionTokens: number,
    isFinal?: boolean
  ) => void;
  onTtsProgress?: (
    threadId: string,
    messageId: string | undefined,
    toolCallId: string | undefined,
    current: number,
    total: number,
    path: string
  ) => void;
  /** 统一批量进度回调（替代 onTtsProgress，覆盖所有批量工具） */
  onBatchProgress?: (
    threadId: string,
    messageId: string | undefined,
    toolCallId: string | undefined,
    progress: BatchProgress
  ) => void;
  messageId?: string;
  toolCallId?: string;
}

const storage = new AsyncLocalStorage<RunContext>();

/** 当前 run 的上下文（跨 async 边界可见），stream 开始时设置、见到 tool_calls 时更新、结束时清空 */
let currentRunContext: RunContext | null = null;

export function setCurrentRunContext(ctx: RunContext | null): void {
  currentRunContext = ctx;
}

export function runWithContext<T>(ctx: RunContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function runWithContextAsync<T>(ctx: RunContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/** 优先取 ALS，否则取模块级 currentRunContext（工具在 LangGraph 内执行时 ALS 可能为空） */
export function getRunContext(): RunContext | undefined {
  return storage.getStore() ?? currentRunContext ?? undefined;
}
