---
title: 纯台词字幕叠层（复用 compose_caption_overlay_on_image）设计
date: 2026-05-08
status: draft-approved
scope: backend/tools + backend/services + frontend/hitl
---

## 背景

当前 `compose_caption_overlay_on_image` 工具用于“字幕 + ruby（拼音/注音行）”叠层，会对 `captionRubyLines` 做强校验（逐字 items 拼接必须与台词一致）。在新增的“只填台词、不需要拼音”场景中，希望尽可能复用现有链路：**VL 定位字幕区域 → HITL 调整框与样式 → 渲染合成出图**。

## 目标

- 复用同一条链路（VL 定位 + HITL 叠字）与同一套 HITL action（`ai.image_caption_overlay`）。
- 为“只台词”场景提供**不依赖 ruby 的叠字能力**：只渲染台词文本，不要求/不校验拼音数据。
- 对现有 `behavior-correction`（ruby 场景）保持**完全后向兼容**（默认行为不变）。

## 非目标

- 不新增“自动生成/修复拼音”的推理链路（不新增 IPC/端口方法）。
- 不在 plain 模式中做多语言复杂排版；继续沿用现有渲染能力与参数体系。

## 现状约束（关键事实）

- `compose_caption_overlay_on_image` 目前必传 `captionRubyLines`，并执行：
  - `normalizeCaptionRubyItemsToScriptText(lines[i].text, items)`
  - `assertCaptionRubyMatchesScriptLines(lines, rubyLines)`（强一致性校验）
- `suggest_caption_regions(imagePath, contextLines)` 输出带几何的 `lines`（归一化 `x,y,w,h`）。

## 总体方案（已选定：方案 1）

**扩展现有工具 `compose_caption_overlay_on_image`，通过新增 `renderMode` 支持 `ruby/plain` 两种渲染模式。**

- `renderMode='ruby'`：沿用现有逻辑与严格校验（默认）。
- `renderMode='plain'`：跳过 ruby 解析与校验，仅渲染台词文本。

## 工具契约（API）设计

工具：`compose_caption_overlay_on_image`

### 新增字段

- `renderMode?: 'ruby' | 'plain'`
  - 默认 `'ruby'`（兼容既有 skill）。

### 字段语义调整

- `captionRubyLines`
  - 在 `renderMode='ruby'` 时：保持必填 + 强校验。
  - 在 `renderMode='plain'` 时：允许省略或传 `null/undefined`，工具不解析、不校验。

### 行为定义

#### ruby 模式（默认）

- `captionRubyLines` → `rubyLines`（排序/索引重写）
- `normalizeCaptionRubyItemsToScriptText(lines[i].text, items)`
- `assertCaptionRubyMatchesScriptLines(lines, rubyLines)`
- HITL payload：
  - `captionBoxes[].items` 为逐字 ruby items
  - UI 展示 ruby 预览与 ruby 字号等参数
- 渲染：ruby 行 + 汉字字幕

#### plain 模式

- 不读取、不解析 `captionRubyLines`
- 不进行 `assertCaptionRubyMatchesScriptLines`
- HITL payload：
  - `captionBoxes` 仍包含 `text` 与几何
  - `captionBoxes[].items` 为空数组（或字段存在但为空）
  - 增加/传递 `renderMode: 'plain'` 用于前端隐藏 ruby 相关 UI
- 渲染：仅汉字字幕

## VL 步骤入参与文本真源决议

复用 `suggest_caption_regions(imagePath, contextLines)`，并明确约束：

- `contextLines` 是**最终要写到图片上的台词真源**。
- VL 的输出 `lines[].text` **不作为真源**。

### 对齐策略（避免 VL 改文案）

在 `suggest_caption_regions` 工具层（或在调用方拿到结果后）强制对齐：

- `lines.length` 与 `contextLines.length` 不一致时：
  - 多的截断；少的补齐默认框（`defaultNormalizedCaptionRect`）。
- 对齐文本：
  - `lines[i].text = contextLines[i]`（覆盖 VL 返回的 `text`）

这样后续叠字工具可以直接信任 `lines[].text`，并在 plain/ruby 两种模式下都保持一致的“文本真源”模型。

## HITL 交互设计（复用 `ai.image_caption_overlay`）

### 可编辑性

- `allowEditCaptionText=true`：
  - plain 模式：允许用户改台词（最终以 HITL 修改后的 `text` 为准）。
  - ruby 模式：沿用现有提示与风险说明（改字后注音不自动更新）。

### UI 差异

- plain 模式：
  - 隐藏 ruby 预览与 ruby 字号控制
  - 保留：框平移/缩放、字幕字号、底衬/描边等样式（沿用现有 style）
- ruby 模式：保持现状

## 错误处理与兜底

- **VL 行数与 `contextLines` 不一致**：工具层补齐/截断后再进入后续流程，避免用户在 HITL 中看到“缺一行/多一行”的不可控状态。
- **图片无法读取尺寸**：保持现有错误（`无法读取图片尺寸`）。

## 影响范围

- 后端：
  - `backend/tools/compose-caption-overlay-on-image.ts`：schema + 分支逻辑
  - `backend/services/caption-overlay-render.ts`：支持“无 ruby items”绘制（若目前强依赖 items）
  - `backend/tools/suggest-caption-regions.ts`（若存在）：增加“覆盖 text + 行数对齐”逻辑（若此逻辑当前不在工具层）
- 前端（HITL）：
  - `ai.image_caption_overlay` 渲染：根据 `renderMode` 隐藏 ruby UI

## 兼容性

- 既有 skill 未传 `renderMode` 时默认为 `'ruby'`，行为保持不变。

