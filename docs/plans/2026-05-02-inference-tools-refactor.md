# 推理与 Tools 重构（范围 B）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 去掉 `MultimodalPort` 的类型绕过（P0），并按设计 spec 分 PR 推进 inference 层 DRY（P1）。

**Architecture:** P0 不扩展端口：`generate_audio` 仅调用已有 `synthesizeSpeech({ items: [单条], rateLimitMs: 0, ... })`，从返回数组取首元素；`MultimodalPortImpl.synthesizeSpeechSingleItem` 改为 `private`，仅供内部循环使用。P1 在 `backend/infrastructure/inference/` 内增量引入共享模块（HTTP、DashScope 取图等），每 PR 一类替换，避免巨型合并。

**Tech Stack:** TypeScript 5、Vitest、Electron 后端（`backend/` DDD 分层）；设计依据：[`docs/superpowers/specs/2026-05-02-inference-tools-refactor-design.md`](../superpowers/specs/2026-05-02-inference-tools-refactor-design.md)。

---

## 前置：本地验证命令（全文通用）

```bash
npm run lint
npx tsc --noEmit
npm run test:run
```

集成（可选、耗 API）：

```bash
npm run test:tools
```

---

### Task 1（PR1 / P0）：`generate_audio` 走 `synthesizeSpeech` + 收紧 `SingleItem` 可见性

**Files:**

- Modify: `backend/tools/generate-audio.ts`（约 51–54 行：去掉 `as any`，改为类型化调用）
- Modify: `backend/infrastructure/inference/multimodal-port-impl.ts`（约 403 行：将 `synthesizeSpeechSingleItem` 改为 `private`）
- Test: `tests/integration/tools/generate-audio.integration.test.ts`（当前直接测 `synthesizeSpeech` 多句，**无需改**即可覆盖端口；若希望显式覆盖「单条 `items`」，可增加一个 `it` 块）
- 检索：`rg "port as any|MultimodalPort.*as any" backend` 期望无匹配

**Step 1：修改 `generate-audio.ts`**

在文件顶部增加类型导入（若尚未存在）：

```typescript
import type { SynthesizeSpeechItem } from '../domain/inference/types.js';
```

将 `getMultimodalPortAsync()` 之后逻辑替换为（保持 `relativePath`、`appendEntries`、返回 JSON 字段不变）：

```typescript
const port = await getMultimodalPortAsync();
const item: SynthesizeSpeechItem = {
  text,
  relativePath,
  number: nextNumber,
};
const ttsResult = await port.synthesizeSpeech({
  items: [item],
  voice,
  format,
  sessionId,
  rateLimitMs: 0,
});
if (ttsResult.audioPaths.length < 1 || ttsResult.audioUris.length < 1) {
  throw new Error('synthesizeSpeech returned no audio for single item');
}
const audioPath = ttsResult.audioPaths[0];
const audioUri = ttsResult.audioUris[0];
```

**Step 2：将 `synthesizeSpeechSingleItem` 标为 `private`**

在 `multimodal-port-impl.ts` 中把

`async synthesizeSpeechSingleItem(`

改为

`private async synthesizeSpeechSingleItem(`

确认类内仅 `synthesizeSpeechImpl` 调用该方法。

**Step 3：运行测试**

```bash
npm run test:run
```

Expected: 全部通过。

**Step 4：运行类型与 Lint**

```bash
npx tsc --noEmit
npm run lint
```

Expected: 无错误。

**Step 5：确认无 `as any` 绕过**

```bash
rg "as any" backend/tools/generate-audio.ts
```

Expected: 无输出（该文件内无 `as any`）。

**Step 6：Commit**

```bash
git add backend/tools/generate-audio.ts backend/infrastructure/inference/multimodal-port-impl.ts
git commit -m "refactor(tools): generate_audio uses synthesizeSpeech, tighten TTS single-item visibility"
```

---

### Task 2（PR2 / P1-1）：HTTP 错误处理辅助函数

**Files:**

- Create: `backend/infrastructure/inference/http-fetch-helpers.ts`（名称可微调，但须落在 `infrastructure/inference/` 下、**不得**被 `domain/` import）
- Modify（按引入顺序逐步替换，单次 PR 可只覆盖 2–3 个 adapter，或一次扫全仓库 `infrastructure/inference/adapters`）：
  - `backend/infrastructure/inference/adapters/t2i/dashscope.ts`
  - `backend/infrastructure/inference/adapters/t2i/zhipu.ts`
  - `backend/infrastructure/inference/adapters/tts/dashscope.ts`、`zhipu.ts`（若存在相同模式）
  - `backend/infrastructure/inference/adapters/vl/dashscope.ts`、`zhipu.ts`
  - `backend/infrastructure/inference/adapters/image-edit/dashscope.ts`
  - 其它在 `rg "res\\.text\\(\\)\\.catch"` 下仍重复的 `adapters/**`

**Step 1：** 在 `http-fetch-helpers.ts` 中实现 `readResponseErrorText(res: Response): Promise<string>` 与 `throwIfNotOk(res: Response, label: string): Promise<void>`（或等价命名），行为与现有「读 body + `throw new Error(\`${label}: ${status}...\`)`」一致。

**Step 2：** 每替换一处，本地执行 `npx tsc --noEmit` + 相关 Vitest。

**Step 3：** `git commit -m "refactor(inference): shared HTTP error helpers for adapters"`

---

### Task 3（PR3 / P1-2）：DashScope 多模态首张图 URL

**Files:**

- Create: `backend/infrastructure/inference/dashscope-multimodal-image-url.ts`（或同目录下更贴切文件名）
- Modify: `backend/infrastructure/inference/adapters/t2i/dashscope.ts`（`extractFirstImageUrlFromContent` 迁移或委托）
- Modify: `backend/infrastructure/inference/adapters/image-edit/dashscope.ts`（`extractImageUrlFromResponse` 委托共享函数）

**Step 1：** 实现单一函数，例如 `extractFirstImageUrlFromDashScopeChoices(output: unknown): string | undefined`，输入形状与现有两处解析一致。

**Step 2：** 单测：若有 `tests/unit` 覆盖 VL/T2I 解析可追加用例；否则依赖现有集成测试。

**Step 3：** `git commit -m "refactor(inference): share DashScope multimodal image URL extraction"`

---

### Task 4（PR4 / P1-3）：image-edit DashScope 同步/异步 POST 去重

**Files:**

- Modify: `backend/infrastructure/inference/adapters/image-edit/dashscope.ts`

**Step 1：** 抽取内部函数，例如 `postEditImageJson(cfg, input, headers: Record<string,string>)`，供 `submitEditImageDashScope`（带 `X-DashScope-Async`）与 `callEditImageDashScopeSync` 共用；**保留** `callEditImageDashScope` 中 `isAsyncUnsupportedError` 回落 `callEditImageDashScopeSync` 的流程不变。

**Step 2：** `npm run test:run` + 若有 image-edit 集成测试则执行。

**Step 3：** `git commit -m "refactor(inference): dedupe DashScope image-edit POST handling"`

---

### Task 5（PR5 / P1-4）：VL + LLM 双厂商薄封装

**Files:**

- Create: `backend/infrastructure/inference/adapters/openai-compatible/` 下共享模块（或 `vl/common.ts` + `llm/common.ts`，以团队偏好为准）
- Modify: `backend/infrastructure/inference/adapters/vl/dashscope.ts`、`zhipu.ts`
- Modify: `backend/infrastructure/inference/adapters/llm/dashscope.ts`、`zhipu.ts`

**Step 1：** 识别完全重复的 `fetch` / JSON 解析 / `choices[0].message.content` 字符串提取，迁入共享函数。

**Step 2：** 全量 `npm run test:run`；若有 `test:inference` 则在有 Key 的环境抽样跑。

**Step 3：** `git commit -m "refactor(inference): share OpenAI-compatible VL/LLM request plumbing"`

---

### Task 6（PR6 / P1-5）：`multimodal-port-impl` 远程图下载

**Files:**

- Modify: `backend/infrastructure/inference/multimodal-port-impl.ts`（`generateImage` 与 `editImage` 内重复块）

**Step 1：** 新增 `private async downloadRemoteImageToBuffer(url: string, label: string): Promise<Buffer>`，内部使用现有 `formatDownloadFetchError`。

**Step 2：** `npm run test:run`

**Step 3：** `git commit -m "refactor(inference): dedupe remote image download in MultimodalPortImpl"`

---

### Task 7（PR7 / P1-6，可选）：`vl-script-response.ts` 错误路径

**Files:**

- Modify: `backend/infrastructure/inference/vl-script-response.ts`
- Test: 若有 `vl-script-response` 单元测试则更新期望；否则依赖调用链集成测试

**Step 1：** 合并冗余 `catch`，不改变对外抛错文案（或刻意统一文案时在 PR 描述中说明）。

**Step 2：** `npm run test:run`

**Step 3：** `git commit -m "refactor(inference): simplify vl-script-response error paths"`

---

## 执行顺序小结

| 顺序 | Task | 依赖 |
|------|------|------|
| 1 | Task 1 P0 | 无 |
| 2 | Task 2 | 无（可与 3 并行由不同人做，注意 merge 冲突） |
| 3 | Task 3 | 无 |
| 4 | Task 4 | Task 3 若已抽「取图」可复用思路；可独立 |
| 5 | Task 5 | 无 |
| 6 | Task 6 | 无 |
| 7 | Task 7 | 低优先级 |

---

## 计划自检

- 与 design spec §4–§5 一致；P0 不修改 `backend/domain/inference/ports/multimodal-port.ts` 方法列表。
- `SynthesizeSpeechItem` 已存在于 `backend/domain/inference/types.ts`，Task 1 仅 import，无需改 domain 结构。
- 提交前检查清单：`npm run lint`、`npx tsc --noEmit`、`npm run test:run`（见 [`docs/development-guide.md`](../development-guide.md)）。

---

**Plan complete and saved to `docs/plans/2026-05-02-inference-tools-refactor.md`. Two execution options:**

1. **Subagent-Driven（本会话）** — 每个 Task 派子代理、任务间人工过一眼，迭代快。需配合 **superpowers:subagent-driven-development**。
2. **Parallel Session（新会话）** — 在 worktree 中新开对话，用 **superpowers:executing-plans** 按 Task 批量执行并设检查点。

你更倾向哪一种？若不需要选择，可直接说「从 Task 1 开始实现」，我可在当前会话按 Task 1 改代码并跑验证。
