# Thinking Token Counter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在“assistant 尚未开始输出文本”的阶段，前端显示一行「思考中… completion tokens: N」，其中 N 必须来自 OpenAI 兼容网关返回的真实 `completion_tokens`，并通过独立 IPC 事件流式推送。

**Architecture:** 后端在 LLM 流式 callbacks 中提取 usage（优先 streaming `usage_metadata`，否则在 `handleLLMEnd` 取最终 usage），经 `RunContext` 转发到 Electron 主进程，再通过新增 `agent:tokenUsage` 推送到渲染进程；前端 `ChatProvider` 维护 live 状态，仅在“未出字”阶段渲染 thinking 行并显示 tokens。

**Tech Stack:** Electron IPC、React 18、TypeScript、Vitest、LangChain JS (`@langchain/openai` `ChatOpenAI` callbacks / `streamUsage`)、deepagents/LangGraph stream。

---

## Notes / Preconditions

- **真实 tokens 约束**：禁止本地 tokenizer 估算；只使用网关返回的 usage（`completion_tokens`）。
- **能力差异**：某些网关只在流结束返回 usage。此时中途显示 `completion tokens: —`，结束时可补一次最终值（可选是否短暂展示）。
- **当前基线测试**：`npm test` 在本环境可能因外部 API 429 限流导致 `tests/integration/tools/generate-image.integration.test.ts` 失败；实现本功能建议以单元测试子集为主（见各任务的 Run 命令）。

---

### Task 1: Define IPC contract for token usage

**Files:**
- Modify: `electron/preload.ts`
- Modify: `electron/preload.cjs`
- Modify: `src/types/types.ts` (或现有类型文件，按项目实际放置)

**Step 1: Write the failing test**

- 如果前端已有对 `window.electronAPI.agent` 的类型测试/编译约束，新增一个最小类型用例，确保 `onTokenUsage` 存在且参数类型正确。
- 若无现成类型测试：本任务可用 `tsc` 编译检查替代（见 Step 2）。

**Step 2: Run test to verify it fails**

Run: `npm -s run typecheck`

Expected: TS 报错：`onTokenUsage` 不存在或类型不匹配。（若项目没有 typecheck 脚本，则先在 `package.json` 添加，再提交。）

**Step 3: Minimal implementation**

- 在 `electron/preload.ts` 的 `electronAPI.agent` 下新增：
  - `onTokenUsage(callback)`：监听 `ipcRenderer.on('agent:tokenUsage', ...)`
- 同步修改 `electron/preload.cjs` 保持一致。
- 在前端共享类型（`src/types/types.ts`）新增事件 payload 类型：

```ts
export type AgentTokenUsageEvent = {
  threadId: string;
  messageId?: string;
  completionTokens: number;
  isFinal?: boolean;
};
```

**Step 4: Run test to verify it passes**

Run: `npm -s run typecheck`

Expected: PASS

**Step 5: Commit**

```bash
git add electron/preload.ts electron/preload.cjs src/types/types.ts
git commit -m "feat(ipc): add agent tokenUsage event"
```

---

### Task 2: Extend RunContext to carry token usage callback

**Files:**
- Modify: `backend/application/agent/run-context.ts`

**Step 1: Write the failing test**

- 新增/修改一个最小单元测试（若已有 run-context 相关测试文件则复用；否则新建）：
  - `getRunContext()` 返回的对象应包含可选 `onTokenUsage`，类型签名正确。

Test: `tests/unit/application/agent/run-context.test.ts`（如不存在则创建）

**Step 2: Run test to verify it fails**

Run: `npm -s test -- --run tests/unit/application/agent/run-context.test.ts`

Expected: FAIL（类型或字段不存在）

**Step 3: Minimal implementation**

在 `RunContext` interface 增加：

```ts
onTokenUsage?: (
  threadId: string,
  messageId: string | undefined,
  completionTokens: number,
  isFinal?: boolean
) => void;
```

**Step 4: Run test to verify it passes**

Run: `npm -s test -- --run tests/unit/application/agent/run-context.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/application/agent/run-context.ts tests/unit/application/agent/run-context.test.ts
git commit -m "feat(agent): add token usage callback to RunContext"
```

---

### Task 3: Capture real completion_tokens from LangChain callbacks (OpenAI-compatible)

**Files:**
- Modify: `backend/infrastructure/inference/adapters/openai-compatible/create-chat-openai-model.ts`
- Modify: `backend/agent/AgentFactory.ts`（将 callbacks 注入到 createLLMFromAIConfig 的 cfg.callbacks）
- Create: `backend/infrastructure/inference/adapters/openai-compatible/usage-extract.ts`
- Test: `tests/unit/inference/openai-compatible-usage-extract.test.ts`

**Step 1: Write the failing test**

在 `usage-extract` 写纯函数解析器测试，覆盖至少 3 种输入：

- streaming usage chunk（带 `usage_metadata` 且包含 `output_tokens`/`completion_tokens` 语义）
- end output（`tokenUsage.completionTokens`）
- 无 usage（返回 null）

**Step 2: Run test to verify it fails**

Run: `npm -s test -- --run tests/unit/inference/openai-compatible-usage-extract.test.ts`

Expected: FAIL（模块不存在）

**Step 3: Minimal implementation**

- 实现 `extractCompletionTokensFromLangChainCallbackPayload(payload: unknown): number | null`
  - 只提取“真实”字段（不做估算）
  - 对多种可能字段名做防御式解析（unknown + 类型守卫）
- 在 `create-chat-openai-model.ts`：
  - 启用 `streamUsage: true`（若当前 `@langchain/openai` 版本支持）
  - 注入 callbacks：`handleLLMNewToken` 和 `handleLLMEnd`
  - 解析到 tokens 时调用 `getRunContext()?.onTokenUsage(threadId, messageId, tokens, isFinal?)`
    - `threadId/messageId` 从 `getRunContext()` 取
    - `handleLLMEnd` 里 `isFinal=true`
- 在 `AgentFactory.ts` 的 `createLLMFromAIConfig` 传入 callbacks（当前已传 `callbacks: []`，需要改为可配置注入，避免覆盖）。

**Step 4: Run test to verify it passes**

Run: `npm -s test -- --run tests/unit/inference/openai-compatible-usage-extract.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/infrastructure/inference/adapters/openai-compatible/create-chat-openai-model.ts backend/infrastructure/inference/adapters/openai-compatible/usage-extract.ts tests/unit/inference/openai-compatible-usage-extract.test.ts backend/agent/AgentFactory.ts
git commit -m "feat(llm): extract and emit real completion token usage"
```

---

### Task 4: Wire token usage through invokeAgentUseCase → Electron IPC

**Files:**
- Modify: `backend/application/agent/invoke-agent-use-case.ts`
- Modify: `electron/ipc/agent.ts`
- Test: `tests/unit/application/agent/invoke-agent-use-case.test.ts`（或新增一个专门用例）

**Step 1: Write the failing test**

扩展现有 `invoke-agent-use-case` 单测：

- 模拟一个 agent stream，触发 `runCtx.onTokenUsage`（或通过 mock callbacks 注入）
- 断言 `callbacks.onTokenUsage` 被调用并携带 `threadId/messageId/completionTokens`

**Step 2: Run test to verify it fails**

Run: `npm -s test -- --run tests/unit/application/agent/invoke-agent-use-case.test.ts`

Expected: FAIL（onTokenUsage 未定义/未转发）

**Step 3: Minimal implementation**

- 在 `invokeAgentUseCase` 的 `callbacks` 定义中新增可选 `onTokenUsage`
- 初始化 `runCtx` 时设置 `onTokenUsage: callbacks.onTokenUsage`
- 在 `electron/ipc/agent.ts` 的 `callbacks` 对象中新增：

```ts
onTokenUsage: (threadId, messageId, completionTokens, isFinal) => {
  mainWindow.webContents.send('agent:tokenUsage', { threadId, messageId, completionTokens, isFinal });
}
```

**Step 4: Run test to verify it passes**

Run: `npm -s test -- --run tests/unit/application/agent/invoke-agent-use-case.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/application/agent/invoke-agent-use-case.ts electron/ipc/agent.ts tests/unit/application/agent/invoke-agent-use-case.test.ts
git commit -m "feat(ipc): stream token usage from backend to renderer"
```

---

### Task 5: Frontend live state + “thinking” row UI

**Files:**
- Modify: `src/providers/ChatProvider.tsx`
- Modify: `src/app/components/ChatInterface.tsx`
- (Optional) Create: `src/app/components/ThinkingRow.tsx`
- Test: `tests/unit/ui/thinking-token-counter.test.tsx`（或放在现有 UI 测试结构下）

**Step 1: Write the failing test**

写一个最小 React 单测（Vitest + RTL，如果项目已有）：

- 初始：`isLoading=true` 且尚无 assistant 文本 → 渲染 `思考中` + `completion tokens: —`
- 触发 `agent:tokenUsage` 事件 → `completion tokens: 12`
- 再触发 `agent:message` 使 assistant content 非空 → thinking 行隐藏

**Step 2: Run test to verify it fails**

Run: `npm -s test -- --run tests/unit/ui/thinking-token-counter.test.tsx`

Expected: FAIL（组件/状态不存在）

**Step 3: Minimal implementation**

- `ChatProvider`：
  - 增加 `thinkingTokensLive` state
  - 在 `useEffect` 中订阅 `window.electronAPI.agent.onTokenUsage`
  - session 切换 / stream 结束时清理
- `ChatInterface`：
  - 在消息列表顶部插入 thinking 行（只在 `isLoading && !hasRenderableAssistantYet`）
  - `completion tokens` 取 `thinkingTokensLive?.completionTokens`，否则 `—`

**Step 4: Run test to verify it passes**

Run: `npm -s test -- --run tests/unit/ui/thinking-token-counter.test.tsx`

Expected: PASS

**Step 5: Commit**

```bash
git add src/providers/ChatProvider.tsx src/app/components/ChatInterface.tsx tests/unit/ui/thinking-token-counter.test.tsx
git commit -m "feat(ui): show real completion tokens during thinking phase"
```

---

### Task 6: Verification + manual QA script

**Files:**
- (Optional) Modify: `docs/development-guide.md`（如需补充调试说明）

**Step 1: Run focused test suite**

Run (unit-only recommended):

- `npm -s test -- --run backend/application/agent/invoke-agent-use-case.test.ts`
- `npm -s test -- --run tests/unit/ui/thinking-token-counter.test.tsx`

Expected: PASS

**Step 2: Manual QA**

- 打开应用，发送一条会触发较长思考的请求（例如要求生成较长文本/多步骤）
- 观察：
  - 未出字阶段出现 `思考中… completion tokens: —/N`
  - 若网关支持 streaming usage：N 会增长
  - 一旦开始出字：thinking 行隐藏

**Step 3: Commit (if any docs updated)**

```bash
git add docs/development-guide.md
git commit -m "docs: note token usage thinking indicator"
```

---

## Execution choice

Plan complete and saved to `docs/plans/2026-05-05-thinking-token-counter.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?

