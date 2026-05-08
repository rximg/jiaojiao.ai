# Caption Overlay Plain Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 扩展 `compose_caption_overlay_on_image` 支持 `renderMode='plain'`，在不提供 `captionRubyLines` 的情况下仅把台词绘制到图片上；并在 `suggest_caption_regions` 中将 VL 输出与 `contextLines` 强制对齐，前端 HITL 根据 `renderMode` 隐藏 ruby 相关 UI。

**Architecture:** 后端工具保持单一入口，通过 `renderMode` 分支决定是否解析/校验 ruby；VL 工具以 `contextLines` 作为文本真源，工具层覆盖 `lines[].text` 并对齐行数；HITL `ai.image_caption_overlay` payload 增加 `renderMode`，前端编辑器按模式裁剪 UI。

**Tech Stack:** TypeScript、Zod、sharp、React、现有 HITL 管线。

---

### Task 1: 为叠字工具新增 `renderMode`（后向兼容）

**Files:**
- Modify: `backend/tools/compose-caption-overlay-on-image.ts`

**Step 1: 写入失败用例（单测或最小运行验证）**
- 若本仓库已有对 tool schema 的单测：新增用例覆盖 `renderMode='plain'` 且不传 `captionRubyLines` 不应抛错。
- 若暂无相关单测：先在本地运行一次最小调用（通过现有 agent/tool runner）验证当前会因缺少 `captionRubyLines` 抛错，作为对照。

**Step 2: 修改 Zod schema**
- 增加：
  - `renderMode: z.enum(['ruby','plain']).optional().describe(...)`
- 将 `captionRubyLines` 改为：
  - `z.union([z.string(), z.array(rubyLineSchema)]).optional()`（plain 可缺省）

**Step 3: 实现分支逻辑**
- `const renderMode = input.renderMode ?? 'ruby'`
- 当 `renderMode === 'ruby'`：
  - 保持现有 `coerceCaptionRubyLines` / `normalizeCaptionRubyItemsToScriptText` / `assertCaptionRubyMatchesScriptLines` 行为不变
- 当 `renderMode === 'plain'`：
  - 不读取 `input.captionRubyLines`
  - 不执行 ruby 规范化与一致性校验
  - `captionBoxes[i].items` 置为 `[]`
- HITL payload 增加：`renderMode`

**Step 4: 本地验证**
Run: `npx vitest run`（若有相关测试）
Expected: PASS

**Step 5:（可选）提交**
- 本步骤按你的工作流决定是否提交；如需我代提交，请你明确说“帮我 commit”。

---

### Task 2: 渲染层支持“无 ruby items”

**Files:**
- Modify: `backend/services/caption-overlay-render.ts`

**Step 1: 阅读现有渲染实现，确认对 `items` 的假设**
- 如果目前渲染逻辑强依赖 `items.length>0` 才能渲染：为 plain 模式增加分支，仅渲染 `text`。
- 如果已兼容空数组：仅补充类型与边界处理（避免空数组导致布局/高度计算异常）。

**Step 2: 添加/调整单测（若已有）**
- 给一个 box：`text='你好'`，`items=[]`，期望生成 SVG/合成不抛错。

**Step 3: 本地验证**
Run: `npx vitest run`
Expected: PASS

---

### Task 3: `suggest_caption_regions` 强制对齐 `contextLines`

**Files:**
- Modify: `backend/tools/suggest-caption-regions.ts`

**Step 1: 行数对齐策略落地**
- 在拿到 `port.generateScriptFromImage(...)` 结果后，读取 `result.lines`
- 对齐到 `contextLines.length`：
  - 多的截断
  - 少的补齐默认 rect（如果结果不带 `w/h`，可补缺省；如工具层没有默认 rect 能力，则至少补 `x,y` 为合理缺省，并把 `w/h` 留空让后续默认逻辑兜底）

**Step 2: 文本强制覆盖**
- `alignedLines[i].text = contextLines[i]`

**Step 3: 本地验证**
- 调一次 tool（或补单测）确保返回的 `lines[].text` 与 `contextLines[]` 完全一致。

---

### Task 4: 前端 HITL 按 `renderMode` 隐藏 ruby UI

**Files:**
- Modify: `src/app/components/HitlConfirmBlock.tsx`
- Modify: `src/app/components/ImageCaptionOverlayEditor.tsx`

**Step 1: 透传 renderMode**
- `payload.renderMode` 读取为 `'ruby' | 'plain'`，默认 `'ruby'`
- 传给 `ImageCaptionOverlayEditor`（新增 prop）

**Step 2: UI 裁剪**
- plain 模式：
  - 隐藏 ruby 预览
  - 隐藏 ruby 字号/颜色等控制项（若存在）
  - 仍允许编辑台词（`allowEditCaptionText=true` 时）
- ruby 模式：保持现状

**Step 3: 本地手工验证**
- 触发一次 `ai.image_caption_overlay`（plain）请求，确认界面无 ruby 控件、可改字、可拖拽框、可继续执行。

---

### Task 5: 更新文档与示例（可选但推荐）

**Files:**
- Modify: `docs/architecture/hitl.md`
- Modify: `docs/plans/2026-05-08-caption-overlay-plain-mode-design.md`（如实现中有调整）

**Step 1: 文档补充**
- 在 `ai.image_caption_overlay` payload 字段中补充 `renderMode`
- 说明 plain 模式不需要 `captionRubyLines`

---

## Execution Handoff

计划已保存到 `docs/plans/2026-05-08-caption-overlay-plain-mode-implementation-plan.md`。

两种执行方式：
- **1) 继续在本会话直接实现**：我会逐 Task 修改代码并跑测试（你无需切会话）
- **2) 先只 review 计划**：你确认无误后我再开始改代码

