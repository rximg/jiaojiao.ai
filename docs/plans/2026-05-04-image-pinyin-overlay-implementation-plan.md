# 图片字幕叠层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已有插画与 **Skill 已生成的字幕 + ruby（逐字读音）** 前提下，通过 VL 建议**字幕区**（HITL）、**字幕叠层** HITL 与 Sharp+SVG 合成落盘，供行为纠正等 skill 在 TTS 前使用成品图。

**Architecture:** 工具 1 `suggest_caption_regions` 扩展 `ScriptLine` 与 VL 解析，沿用 `MultimodalPort.generateScriptFromImage` + `vl_caption_regions.yaml`；工具 2 `compose_caption_overlay_on_image` 接收 VL 返回的 `lines` 与同序 `**captionRubyLines`**（Agent 在「生成字幕」步骤已产出），入参做 Zod + 与 `text` 拼接一致性校验；**不**增加独立「仅读音」LLM、`ToolContext` 读音注入、**不**增加 `inference:*-annotate` IPC；渲染复用 `sharp` + SVG composite；叠层 HITL 以字幕框/字号为主，**ruby 只读展示**（可选允许改字但须 UI 提示不自动更新读音）。

**Tech Stack:** TypeScript 5.5、Vitest、Zod、`sharp`、React 18、现有 HITL 管线。

**规格对照：** [docs/superpowers/specs/2026-05-04-image-pinyin-overlay-design.md](../superpowers/specs/2026-05-04-image-pinyin-overlay-design.md)

---

## 文件结构（创建 / 修改一览）


| 路径                                                       | 职责                                                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `backend/domain/inference/types.ts`                      | `ScriptLine` 增加 `w?`、`h?`；`**CaptionRubyItem`**（`char`, `reading`）、`**CaptionRubyLine**`（`index`, `items`） |
| `backend/infrastructure/inference/vl-script-response.ts` | 解析 `w`、`h`                                                                                                 |
| `backend/services/caption-region-geometry.ts`            | 归一化 → 像素、clamp                                                                                             |
| `backend/services/caption-ruby-payload.ts`               | `**parseCaptionRubyPayload**`、`**assertCaptionRubyMatchesScriptLines**`（Zod；放 services，避免 domain 依赖 zod）   |
| `backend/config/tools/vl_caption_regions.yaml`           | 字幕区 VL prompt                                                                                              |
| `backend/tools/suggest-caption-regions.ts`               | 工具 1                                                                                                       |
| `backend/tools/compose-caption-overlay-on-image.ts`      | 工具 2：校验 + HITL `ai.image_caption_overlay` + 合成                                                             |
| `backend/services/caption-overlay-render.ts`             | Sharp + SVG（`captionText*` / `captionRuby*` 样式键）                                                           |
| `backend/tools/index.ts`                                 | 注册两工具                                                                                                      |
| `backend/config/hitl-config.ts`                          | `ai.vl_caption_regions`、`**ai.image_caption_overlay**`                                                     |
| `src/app/components/HitlConfirmBlock.tsx`                | 两路 HITL UI                                                                                                 |
| `src/app/components/ImageCaptionOverlayEditor.tsx`       | 字幕框/字号/只读 ruby；可选改字 + 提示                                                                                   |
| `backend/config/skills/behavior-correction/config.yaml`  | 启用工具                                                                                                       |
| `backend/config/skills/behavior-correction/SKILL.md`     | 第 2 步字幕+`captionRubyLines` 格式与调用参数                                                                         |
| `docs/architecture/hitl.md`                              | 映射表                                                                                                        |
| `tests/unit/inference/vl-script-response.test.ts`        | w/h                                                                                                        |
| `tests/unit/services/caption-region-geometry.test.ts`    | 几何                                                                                                         |
| `tests/unit/services/caption-ruby-payload.test.ts`       | 解析与 text/items 一致性                                                                                         |


**明确不创建：** 独立「注音 LLM」模块、`pinyin_structured.yaml`、`electron/ipc/inference-bridge.ts`、`ToolContext.invoke*Annotation` 等。

---

### Task 1: 扩展 ScriptLine 与 CaptionRuby 领域类型

**Files:**

- Modify: `backend/domain/inference/types.ts`
- Modify: `backend/domain/inference/index.ts`
- **Step 1: 写入领域类型**

```typescript
export interface ScriptLine {
  text: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
}

/** 字幕内单字（或单展示单位）及其读音行（ruby），如汉语拼音带声调；标点等可为空串 */
export interface CaptionRubyItem {
  char: string;
  reading: string;
}

/** 一行字幕对应的 ruby 序列，与 ScriptLine.text 对齐 */
export interface CaptionRubyLine {
  index: number;
  items: CaptionRubyItem[];
}
```

- **Step 2: 导出** `CaptionRubyItem`、`CaptionRubyLine` from `backend/domain/inference/index.ts`
- **Step 3: Commit**

```bash
git add backend/domain/inference/types.ts backend/domain/inference/index.ts
git commit -m "feat(domain): ScriptLine w/h 与 CaptionRuby 类型"
```

---

### Task 2: VL 解析 w/h

**Files:**

- Modify: `backend/infrastructure/inference/vl-script-response.ts`
- Modify: `tests/unit/inference/vl-script-response.test.ts`
- **Step 1: 失败测试**（`optional w h` case）
- **Step 2: 实现** `w`/`h` 可选解析并入 `ScriptLine`
- **Step 3: Commit** `feat(vl): 解析字幕框 w/h`

---

### Task 3: 归一化几何 → 像素 + clamp

**Files:**

- Create: `backend/services/caption-region-geometry.ts`
- Create: `tests/unit/services/caption-region-geometry.test.ts`
- 内容同前：`defaultNormalizedCaptionRect`、`normalizedRectToPixelRect`
- **Commit** `feat: 字幕区归一化坐标转像素并 clamp`

---

### Task 4: Caption ruby 载荷解析与「items ↔ text」一致性

**Files:**

- Create: `backend/services/caption-ruby-payload.ts`
- Create: `tests/unit/services/caption-ruby-payload.test.ts`
- **Step 1: 测试**

```typescript
import { describe, it, expect } from 'vitest';
import {
  parseCaptionRubyPayload,
  assertCaptionRubyMatchesScriptLines,
} from '../../../backend/services/caption-ruby-payload.js';
import type { ScriptLine } from '#backend/domain/inference/index.js';

describe('caption-ruby-payload', () => {
  it('parseCaptionRubyPayload accepts valid JSON', () => {
    const raw = JSON.stringify({
      lines: [{ index: 0, items: [{ char: '宝', reading: 'bǎo' }, { char: '。', reading: '' }] }],
    });
    const out = parseCaptionRubyPayload(raw);
    expect(out.lines[0].items[1].reading).toBe('');
  });

  it('assertCaptionRubyMatchesScriptLines passes when chars join to text', () => {
    const script: ScriptLine[] = [{ text: '宝。', x: 0, y: 0 }];
    const pl = { lines: [{ index: 0, items: [{ char: '宝', reading: 'bǎo' }, { char: '。', reading: '' }] }] };
    expect(() => assertCaptionRubyMatchesScriptLines(script, pl.lines)).not.toThrow();
  });

  it('assertCaptionRubyMatchesScriptLines throws on mismatch', () => {
    const script: ScriptLine[] = [{ text: '你好', x: 0, y: 0 }];
    const pl = { lines: [{ index: 0, items: [{ char: '你', reading: 'nǐ' }] }] };
    expect(() => assertCaptionRubyMatchesScriptLines(script, pl.lines)).toThrow();
  });
});
```

- **Step 2: 实现**
- `parseCaptionRubyPayload`：Zod 校验根对象 `lines[]`，元素含 `index`、`items: { char, reading }`。
- `assertCaptionRubyMatchesScriptLines(scriptLines, rubyLines)`：条数一致；每行 `items.map(i => i.char).join('')` 与 `scriptLines[i].text` 经 Unicode 规范化后一致。
- **Step 3: Commit** `feat: caption ruby 载荷解析与字幕一致性校验`

---

### Task 5: 仅添加 vl_caption_regions.yaml

**Files:**

- Create: `backend/config/tools/vl_caption_regions.yaml`
- Prompt 文案以「**字幕区**」为主语（非「拼音区」）；不要求 `pinyin_structured.yaml`。
- **Commit** `chore(config): vl_caption_regions 字幕区 prompt`

---

### Task 6: 工具 suggest_caption_regions

**Files:**

- Create: `backend/tools/suggest-caption-regions.ts`
- Modify: `backend/tools/index.ts`
- Modify: `backend/config/skills/behavior-correction/config.yaml`
- HITL `ai.vl_caption_regions`，`contextLines` = 字幕文案列表。
- **Commit** `feat(tools): suggest_caption_regions`

---

### Task 7: HITL ai.vl_caption_regions

**Files:**

- Modify: `backend/config/hitl-config.ts`
- Modify: `src/app/components/HitlConfirmBlock.tsx`
- **Commit** `feat(hitl): ai.vl_caption_regions`

---

### Task 8: caption-overlay-render（Sharp + SVG）

**Files:**

- Create: `backend/services/caption-overlay-render.ts`
- Create: `tests/unit/services/caption-overlay-render.test.ts`
- 样式对象键名：`**captionTextFontSizePx` / `captionRubyFontSizePx`**，`**captionTextColor` / `captionRubyColor**`（与规格 §7 一致）；`buildCaptionOverlaySvg` 的示例断言使用 `reading: 'bǎo'`。
- **Commit** `feat: 字幕叠层 SVG 与 Sharp 合成`

---

### Task 9: 前端 ImageCaptionOverlayEditor（无读音 IPC）

**Files:**

- Create: `src/app/components/ImageCaptionOverlayEditor.tsx`
- Modify: `src/app/components/HitlConfirmBlock.tsx`
- Modify: `backend/config/hitl-config.ts`
- 注册 `**ai.image_caption_overlay`**（**禁止**再使用 `ai.image_pinyin_overlay`）。
- `ACTION_TITLE['ai.image_caption_overlay']`：如「确认字幕叠层与注音？」
- 只读展示 `**items[].reading`**；禁止 `inference:*-annotate`。
- **Commit** `feat(ui): 字幕叠层 HITL（ai.image_caption_overlay）`

---

### Task 10: 工具 compose_caption_overlay_on_image

**Files:**

- Create: `backend/tools/compose-caption-overlay-on-image.ts`
- Modify: `backend/tools/index.ts`
- **Schema 要点**：`captionRubyLines: z.array(z.object({ index, items: z.array(z.object({ char, reading })) }))`
- **流程**：
  1. `parseCaptionRubyPayload`（或等价 Zod）校验 `captionRubyLines`。
  2. `assertCaptionRubyMatchesScriptLines(lines, captionRubyLines)`。
  3. `sharp` metadata → 像素框。
  4. 组装 HITL payload（每框：`text`、`items`（`CaptionRubyItem[]`）、像素 rect、默认 **captionText/Ruby** 样式）。
  5. `requestApprovalViaHITL('ai.image_caption_overlay', payload)` → `merged`。
  6. `composeCaptionOverlayImage` 使用 `merged` 快照。
  7. 返回 `{ imagePath, imageUri, sessionId }`。
- **Commit** `feat(tools): compose_caption_overlay_on_image`

---

### Task 11: 行为纠正 SKILL + config

**Files:**

- Modify: `backend/config/skills/behavior-correction/SKILL.md`
- Modify: `backend/config/skills/behavior-correction/config.yaml`
- Todo 第 2 项：**「生成字幕（含 ruby）」**；第 4 项：**「字幕叠层确认」**。
- 工作流：`captionRubyLines` 使用 §6 JSON（字段 `**reading`**）；`compose_caption_overlay_on_image(..., captionRubyLines: ...)`。
- **Commit** `docs(skill): 字幕与 ruby 同步生成及叠层参数`

---

### Task 12: hitl.md 与全量测试

**Files:**

- Modify: `docs/architecture/hitl.md`
- 表与 Callsites：`**ai.image_caption_overlay`**（替换任何 `ai.image_pinyin_overlay` 旧名）。
- `npx vitest run` 全部 PASS。
- **Commit** `docs: HITL 映射字幕叠层`

---

## Self-Review


| 规格章节            | 对应 Task   |
| --------------- | --------- |
| 双工具 + HITL      | 6–7, 9–10 |
| VL / ScriptLine | 1–2, 5, 6 |
| 坐标与 clamp       | 3         |
| ruby 由 Skill 生成 | 4, 10, 11 |
| 叠层 HITL         | 9         |
| 渲染参数            | 8, 9      |
| 测试              | 2–4, 8    |


**类型一致：** `captionRubyLines` 与 `lines` 按索引对齐；`CaptionRubyLine.index` 与数组下标一致。

---

## Execution Handoff

**Plan complete:** `docs/plans/2026-05-04-image-pinyin-overlay-implementation-plan.md`

1. **Subagent-Driven（推荐）** — superpowers:subagent-driven-development
2. **Inline Execution** — superpowers:executing-plans

