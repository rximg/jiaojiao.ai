# 推理适配层与 Tools 重构设计（范围 B）

**日期**：2026-05-02  
**状态**：已确认方向（方案 1 + 方案 3 组合）  
**范围**：`backend/infrastructure/inference/`、`backend/tools/` 中经 `MultimodalPort` 的调用、以及为消除类型绕过所需的 **domain 类型**（默认不扩展 `MultimodalPort` 方法面）。

---

## 1. 背景与目标

- 审查结论：`generate_audio` 使用 `(port as any).synthesizeSpeechSingleItem`，破坏「Tools 只依赖端口契约」；VL/LLM/T2I/image-edit 等处存在重复的 HTTP 错误处理、DashScope 轮询与取图逻辑等。
- **目标**：在**对外行为与产物路径保持一致**的前提下，去掉类型绕过；将 DRY 改进按独立 PR 分阶段落地。
- **非目标**：本设计不强制实现智谱 `edit_image`；不扩展 `electron/` 或 gateway；不引入新的 AI 供应商。

---

## 2. 已确认方案组合

| 层级 | 方案 | 说明 |
|------|------|------|
| **P0 契约** | **方案 1** | 先修 Tools 与端口使用方式，推断理层，每步可测、可回滚。 |
| **P0 具体手段** | **方案 3** | **不**在 `MultimodalPort` 上新增 `synthesizeSpeechSingleItem`；`generate_audio` 改为调用现有 **`synthesizeSpeech`**，传入 **`items: [单条]`**、`rateLimitMs: 0`（或等价配置），从返回的 `audioPaths` / `audioUris` 取首元素。 |

**附带收益**：单条路径统一走 `synthesizeSpeech` 外层的 `traceAiRun('inference.tts', ...)`，与批量 TTS 可观测性一致（原先直调 `synthesizeSpeechSingleItem` 不经过该 trace）。

---

## 3. 范围边界（范围 B）

**包含**：

- `backend/domain/inference/`：必要时仅增补与工具入参相关的类型或注释；**默认不修改** `MultimodalPort` 接口方法列表。
- `backend/infrastructure/inference/`：适配器、`multimodal-port-impl.ts`、`vl-script-response.ts` 等。
- `backend/tools/`：凡通过 `getMultimodalPortAsync()` 使用 `MultimodalPort` 的工具（本轮 P0 明确包含 `generate-audio.ts`）。

**不包含**：

- 智谱图像编辑业务实现（占位类可保留抛错直至有产品需求）。
- 纯前端与 IPC 协议变更（除非未来某 PR 为配合可观测字段而必须修改，本设计不要求）。

**验收标准**：

- `backend` 内不存在对 `MultimodalPort` 的 `as any` 等绕过。
- `generate_audio` 行为不变：仍分配 `relativePath`、调用 `appendEntries`、返回 JSON 字段语义与现实现一致。
- 全量 Vitest 通过；若有 TTS 相关单测则覆盖单条 `items` 路径。

---

## 4. P0：`generate_audio` 实现要点

1. 构造 `SynthesizeSpeechItem`：`text`、`relativePath`（与现逻辑相同）、可选 `number: nextNumber`（若当前批量接口会回传 `numbers`，保持与 `appendEntries` 一致）。
2. 调用 `port.synthesizeSpeech({ items: [item], voice, format, sessionId, rateLimitMs: 0 })`（若 `rateLimitMs` 缺省行为已是 0 或单条无等待，以实现为准，**不得**引入条间无意义延迟）。
3. 校验 `audioPaths.length >= 1`（及 `audioUris`），否则抛出明确错误。
4. `MultimodalPortImpl`：`synthesizeSpeechSingleItem` 保留为 **private**（或由 `synthesizeSpeechImpl` 独占），避免双公开入口；无需新增公共方法。

---

## 5. P1：Infrastructure 分阶段重构清单

按**独立 PR**推进，每项完成后可单独合并：

1. **HTTP 辅助**：统一 `!res.ok` 时读取 body 文本与抛错前缀（如 `readResponseErrorText` + `assertFetchOk`），替换 T2I / TTS / VL / image-edit 等重复片段。
2. **DashScope 多模态出图 URL**：合并 T2I 与 image-edit 中从 `choices[].message.content` 提取首张图 URL 的逻辑至共享函数（文件位置放在 `infrastructure/inference/` 下专用小模块，避免 domain 依赖 infrastructure 的反向问题——仅 infrastructure 内部引用）。
3. **image-edit（DashScope）**：`submitEditImageDashScope` 与 `callEditImageDashScopeSync` 共享 POST + JSON 解析 + `data.code` 校验等分支；**保留** async 失败时 `isAsyncUnsupportedError` 回落 sync 的语义。
4. **VL / LLM 双厂商**：抽取 OpenAI 兼容请求/解析的共享层，DashScope / Zhipu 各留薄封装。
5. **`multimodal-port-impl`**：`generateImage` 与 `editImage` 中远程 `imageUrl` 下载 + `formatDownloadFetchError` 合并为私有方法。
6. **`vl-script-response.ts`**：错误路径收敛（低优先级，行为以现有单测为准）。

---

## 6. 测试与回归

- 执行项目文档中的测试命令（如 `pnpm test` / Vitest）。
- **手工/清单**（若无自动化）：单次 `generate_audio`、文件写入路径、`line-numbers` 与 `appendEntries` 一致性。

---

## 7. 交付节奏建议

| 顺序 | 内容 |
|------|------|
| PR1 | P0：`generate-audio` + 全仓库确认无 `port as any`。 |
| PR2+ | §5 中 P1 条目按 1→2→3… 顺序或团队调整后的顺序，每 PR 一类改动。 |

---

## 8. 设计自检（Spec self-review）

- **占位符**：无 TBD/TODO。
- **一致性**：P0 不扩端口与 §4 一致；P1 不强制与 P0 同 PR。
- **范围**：单份 spec 对应「B 范围重构」；若 C 范围（含 electron）另开 spec。
- **歧义**：`rateLimitMs` 以「单条无额外等待」为判据，若默认已是 2000 且单条仍会 `await`，实现时需在 PR 中显式传 `0` 或调整 `synthesizeSpeechImpl` 仅在 `i > 0` 时 delay（属实现计划细节，本设计仅要求**不恶化延迟**）。

---

## 9. 后续步骤

实现阶段前使用 **writing-plans** 技能生成 `docs/plans/` 下的实现计划（含文件级任务与测试命令），再按 PR1→PR2 执行。
