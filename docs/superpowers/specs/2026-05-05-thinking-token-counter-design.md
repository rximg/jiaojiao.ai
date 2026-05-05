# “思考中”真实 Completion Tokens 动态计数（方案 1）设计

## 背景与问题

当前前端在 Agent 流式输出前会显示一条静止的「思考中」，但后端实际上已经在流式运行；用户体感像“卡住”。希望在“尚未出字”的阶段，展示一个**动态变化**且**必须真实**的指标：**completion tokens**。

约束（已确认）：

- 渠道：可能是 DashScope/智谱等，但统一走 **OpenAI 兼容网关**。
- 指标：**completion tokens**（不显示 total/prompt）。
- 真实性：必须来自**服务端返回的 usage**，禁止本地 tokenizer 估算。
- UI 形态：只在“还没出任何 assistant 文本”时显示一行独立的「思考中 + tokens」；一旦开始出字就隐藏该行（不贴到消息底部）。

## 目标（Goals）

- 在“思考中（尚未出字）”阶段显示 `completion tokens: N`，并在支持的网关/模型上随流式更新而增长。
- 不改变现有消息流式合并逻辑（`agent:message` 仍只承载消息内容）。
- 对不支持 streaming usage 的网关/模型，仍保持“真实”：中途显示 `—`，结束时一次性显示最终 completion tokens（可选是否短暂展示）。

## 非目标（Non-goals）

- 不做 tokenizer 估算或字符数替代。
- 不做成本估算（¥/$）、TPS、首 token 延迟等扩展（后续可加）。
- 不在消息正文底部显示 token 计数（本设计仅实现独立 thinking 行）。

## 依赖与可行性（关键事实）

LangChain JS 的 `@langchain/openai` `ChatOpenAI` 在启用 `streamUsage: true` 时，会请求 OpenAI 的 `stream_options.include_usage=true`，从而在流式中**追加一个 usage chunk**（通常 content 为空但带 `usage_metadata`）。

但实际是否“动态增长”取决于网关实现：

- **理想**：网关在流式过程中持续返回 usage/usage_metadata（或至少在多个 chunk 上更新 usage）。
- **常见**：只在流式结束追加一次 usage chunk（仍然是真实，只是不够“动态”）。

因此必须实现：

- **能力探测**：运行中如果收到 usage 更新则实时显示；否则保持 `—`。
- **降级路径**：结束时若收到最终 usage，则更新一次（仍真实）。

## UX / 交互设计

### 何时显示

满足以下条件才显示 thinking 行：

- 当前会话 `isLoading === true`
- 且尚未出现可渲染的 assistant 文本（当前实现中 `isRenderableMessage` 以 `content.trim().length>0` 为主）

### 展示内容

- 主文案：`思考中…`
- 辅助文案：`completion tokens: N`
  - 若运行中未收到任何真实 usage：显示 `completion tokens: —`

### 何时隐藏

- 一旦收到第一段 assistant 可渲染文本（content 非空）即隐藏（即使后续还会收到 usage 事件）。

## 数据流与事件契约

### 新增 IPC 事件：`agent:tokenUsage`

从主进程推送到渲染进程（与现有 `agent:message` 同级）：

```ts
type AgentTokenUsageEvent = {
  threadId: string;        // sessionId
  messageId?: string;      // 当前 run 绑定的 assistant 消息 id（建议提供）
  completionTokens: number;
  isFinal?: boolean;       // 可选：结束时 true
};
```

语义：

- `completionTokens` 必须来自上游/网关返回的真实 usage。
- 若仅结束时可得 usage，则只发一次 `isFinal=true` 的事件。
- 若流式中多次收到 usage 更新，则多次发事件（需要节流）。

### 后端采集点（推荐）

在创建 `ChatOpenAI` 时注入 callbacks：

- `handleLLMNewToken(token, runId?, parentRunId?, tags?, fields?)`：用于接收流式 chunk（含 usage_metadata 的特殊 chunk）
- `handleLLMEnd(output)`：用于结束时拿到最终 tokenUsage（如果流式拿不到）

并在回调内解析：

- `usage_metadata`（stream usage chunk）
- 或 `llmOutput?.tokenUsage` / `output?.llmOutput?.tokenUsage`（结束时 usage）

将解析出的 `completionTokens` 通过 `RunContext` 的新回调 `onTokenUsage` 抛到上层（`invokeAgentUseCase` → `electron/ipc/agent.ts` → `webContents.send('agent:tokenUsage', ...)`）。

> 现有 `RunContext` 已承载 `threadId/messageId/toolCallId` 与 progress callbacks，非常适合扩展一个 `onTokenUsage`。

### 节流策略

- 后端按时间节流：例如 \(100\sim200ms\) 最多推送一次（避免 UI 频繁 setState）。
- 或按 token 增量节流：例如每增长 ≥10 tokens 推一次。

## 前端实现范围（设计级）

### `preload.ts/.cjs`

- 暴露 `window.electronAPI.agent.onTokenUsage(cb)` 监听 `agent:tokenUsage`。

### `ChatProvider.tsx`

新增状态（仅 live，不必持久化到 session）：

```ts
thinkingTokensLive: {
  threadId: string;
  messageId?: string;
  completionTokens: number;
  isFinal?: boolean;
} | null
```

更新逻辑：

- 仅当 `data.threadId === currentSessionId` 时更新。
- 若当前已经出现 assistant 可渲染文本，则可以选择忽略后续 tokenUsage（保持 thinking 行隐藏）。
- 流结束（`agent:streamEnd` 或 `isLoading=false`）时清空。

### `ChatInterface.tsx`

在消息列表上方渲染 thinking 行：

- `isLoading && !hasRenderableAssistantYet` 时显示
- `completionTokens` 从 `thinkingTokensLive` 取；无则显示 `—`

（实现细节：`hasRenderableAssistantYet` 可以用 `messages` 中最新 assistant 消息的 `content.trim().length>0` 判定，或更精确地跟踪“本次 run 的 assistant messageId 是否已出现 content”。）

## 测试策略

### 单元测试（前端）

- 模拟 `agent:tokenUsage` 事件到 `ChatProvider`：
  - 未出字时：thinking 行显示 `N`
  - 一旦收到 assistant content：thinking 行隐藏
  - 不同 threadId：忽略

### 单元测试（后端）

- 对 usage 解析函数做纯函数测试（输入不同形态的 callback payload，输出 completionTokens 或 null）。
- 对节流器做最小测试（确保不会超频发送）。

## 兼容性与降级

- 若网关/模型不支持 streaming usage：中途显示 `—`，结束时（如能拿到最终 usage）更新一次并立即清空（或短暂显示 300ms 后清空，二选一，默认“立即清空”以避免闪烁）。
- 任何情况下不做估算，保证“真实 token”语义不被污染。

## 变更清单（实现时的文件触点）

- 后端
  - `backend/infrastructure/inference/adapters/openai-compatible/create-chat-openai-model.ts`：启用 `streamUsage: true`（如该版本支持）并注入 callbacks
  - `backend/application/agent/run-context.ts`：新增 `onTokenUsage` 回调
  - `backend/application/agent/invoke-agent-use-case.ts`：在 run 生命周期内转发 tokenUsage
  - `electron/ipc/agent.ts`：新增 `onTokenUsage` → `webContents.send('agent:tokenUsage', ...)`
- 前端
  - `electron/preload.ts` + `electron/preload.cjs`：新增 `agent.onTokenUsage`
  - `src/providers/ChatProvider.tsx`：新增状态与监听
  - `src/app/components/ChatInterface.tsx`（或 `ChatMessage`）：新增 thinking 行 UI

