# 图片字幕叠层（双工具 + HITL）设计规格

**日期**：2026-05-04  
**修订**：2026-05-04 — 命名以 **caption（字幕）** 为主，**ruby（注音行，如拼音）** 为辅；注音与台词同步由 Skill/Agent 产出，无独立注音 LLM / IPC。

**状态**：已定稿（修订版），与 `docs/plans/2026-05-04-image-pinyin-overlay-implementation-plan.md` 对齐。

---

## 1. 目标与范围

- 在**已有插画**的前提下：先在 **Skill 流程内**生成**字幕文案 + 逐字注音（ruby）**，再为每句字幕在画面上找到合适区域，经 **HITL** 调整几何与可选样式后，将**注音行在上、字幕汉字在下**绘制到图上并落盘。
- **行为纠正** skill：在**字幕与 ruby 已定稿之后、TTS 之前**完成画面定稿，再进入配音与收尾。
- **Inference**：**不新增** `MultimodalPort` 方法；**字幕区布局**继续走现有 `**generateScriptFromImage`**（VL 大类），通过**独立 prompt 配置**区分「台词+点」与「字幕框+区域」。
- **Ruby 数据**：**不**再引入独立「仅注音」LLM 链路、**不**增加 `inference:*-annotate` 等 IPC；**逐字读音**随 **生成字幕** 步骤一并给出，由工具入参校验与 HITL 展示使用。

---

## 2. 双工具划分


| 工具（拟注册名）                           | 职责                                                                                                | HITL                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `suggest_caption_regions`          | 调用 VL（`generateScriptFromImage` + 字幕区专用 `prompt`），解析为带几何的「行」列表                                    | **要**（与现 `generate_script_from_image` 类似：审图 + 可改 `userPrompt` 再跑 VL） |
| `compose_caption_overlay_on_image` | 合并 **VL 几何** 与 **Skill 已生成的 `captionRubyLines`** → **字幕叠层 HITL**（几何 + 字号；文案以字幕步骤为准）→ Sharp+SVG 合成 | **要**（`ai.image_caption_overlay`）                                    |


Agent 顺序：`generate_image` → **生成字幕（含 ruby）** → `**suggest_caption_regions`**（传入与字幕对齐的 `contextLines`）→ `**compose_caption_overlay_on_image`**（传入 VL `lines` + 同序 `**captionRubyLines**`）→ `batch_tool_call(generate_audio)` → `finalize_workflow`（`imagePath` 使用叠字幕成品）。

---

## 3. VL 扩展方式（仅 prompt + 类型/解析，不新增端口方法）

- **配置**：新增 `backend/config/tools/vl_caption_regions.yaml`（或等价路径），内含**字幕区**任务的系统提示词；工具 1 从该文件读取 `prompt` 传入 `generateScriptFromImage({ ..., prompt })`。
- **输出 JSON**：要求模型返回与现解析器兼容的**数组**，元素在 `text, x, y` 基础上增加 `**w`, `h`**（字幕框宽、高）。坐标系见第 4 节。
- **领域类型**：扩展 `ScriptLine`：`w?: number; h?: number`（可选，缺省时由工具层按默认矩形或规则兜底，具体在实现计划中写死）。
- **解析**：扩展 `parseVlScriptLinesFromModelContent`：若存在 `w`、`h` 则写入；否则仅 `text,x,y`。
- **工具 1 HITL**：复用或对齐 `ai.vl_script` 体验（图 + 可编辑补充说明）；payload 至少含 `imagePath`、`userPrompt?`、以及供界面展示的 `**contextLines`（字幕文案）** 上下文。若与现 `ai.vl_script` payload 不完全一致，可在 `hitl-config` 中新增 `actionType`（例如 `ai.vl_caption_regions`）与专用标题，但**后端 VL 调用仍只走** `generateScriptFromImage`。

---

## 4. 坐标系（拍板由实现侧选定）

- **VL 输出**：**归一化**，`x, y, w, h` 均为 **0–1** 相对整幅图（左上原点，向右 x、向下 y；`w/h` 为相对宽高）。
- **工具层**：读图 `metadata` 后乘 `width/height` 转为**像素**，再交给 HITL 与渲染；越界按与 `annotate_image_with_numbers` 一致的 **clamp** 策略处理。

---

## 5. 工具 2：字幕叠层 HITL 交互

- **几何**：平移；**四角拖动**改宽高；**不允许旋转**。
- **字号**：可改 `**captionTextFontSizePx`**（字幕汉字）、`**captionRubyFontSizePx`**（注音行）；或统一缩放因子，由实现选一种写入计划。
- **文案与 ruby**：
  - **主真源**：Skill「生成字幕（含 ruby）」步骤产出的 `**captionRubyLines`**（与字幕条数、顺序一致）。
  - **首版推荐**：叠层 HITL 中 **ruby 行只读**；**不**做改字后的自动读音刷新，**不**增加 IPC 读音通道。
  - 若实现侧允许微调汉字：须 **明确提示**「改字后注音不会自动更新」；严重不一致时应引导用户回到**字幕步骤**重新生成（产品策略，非本规格强制）。

---

## 6. 结构化 ruby 载荷（由 Skill 生成，工具校验）

- **不**使用本地拼音库作为失败降级（与「数据来自 Agent 生成」一致；若 Agent 未按格式给出则由工具解析/校验失败并报错，由 Agent/用户重试）。
- **推荐 JSON 形状**（与字幕条数一致，由 Agent 在生成字幕时一并输出或作为工具参数传入）：

```json
{
  "lines": [
    {
      "index": 0,
      "items": [
        { "char": "宝", "reading": "bǎo" },
        { "char": "。", "reading": "" }
      ]
    }
  ]
}
```

- **约定**：
  - `char`：单个展示单位（以 **Unicode 标量** 为主；数字、字母可按一字一项或按产品再定）。
  - `reading`：**带声调**的汉语拼音等读音字符串（如 `bǎo`）；标点、空格等 **空字符串**。
  - 一行内 `items` 顺序与界面从左到右阅读顺序一致；**拼接 `char` 须与该句字幕 `text` 一致**（实现侧做规范化比较，不一致则拒绝合成）。
- **SKILL.md 要求**：在「生成字幕」步骤中**同时**产出上述结构，并在调用 `compose_caption_overlay_on_image` 时传入 `**captionRubyLines`**（与 `suggest_caption_regions` 返回的 `lines` 按索引对齐）。**不**在叠字工具内再次调用 LLM 仅为生成读音。

---

## 7. 渲染可调参数（默认 + 可选）

以下由 HITL `merged` 或工具默认提供，**有默认、可在界面或高级选项中调整**（首版可部分仅后端默认）：


| 参数                                                | 含义         | 默认建议                                                           |
| ------------------------------------------------- | ---------- | -------------------------------------------------------------- |
| `captionTextFontSizePx` / `captionRubyFontSizePx` | 字幕汉字与注音行字号 | 如 28 / 14，可在 HITL 调整                                           |
| `fontFamily`                                      | 字体栈        | `"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif` |
| `captionTextColor` / `captionRubyColor`           | 填充色        | 深灰 / 略浅灰                                                       |
| `textStrokeWidth` / `textStrokeColor`             | 描边（压暗插画底）  | 默认细描边 + 深半透明                                                   |
| `boxBackgroundOpacity`                            | 可选圆角底衬不透明度 | 默认如 `0.75`；`0` 表示无底衬                                           |
| `boxPaddingPx`                                    | 字与框边距      | 默认小 padding                                                    |


合成路径仍沿用 `**sharp` + SVG overlay**（与数字标注一致），具体 SVG 模板在实现计划中细化。

---

## 8. 行为纠正 Skill：Todo 项（5～6 项）

将原固定 4 项扩展为与步骤严格一致（文案与顺序需与前端进度约定联调），建议：

1. 生成双分镜图片
2. **生成字幕（含 ruby）** — 输出结构化 `captionRubyLines`，供后续叠层与 TTS 使用
3. 字幕区布局（VL + HITL）— 对应工具 1
4. **字幕叠层确认**（HITL + 出图）— 对应工具 2
5. 将台词合成语音
6. 完成工作流并返回结果

若产品希望合并 3–4 为一步展示，可改为 5 项，但须在 `SKILL.md` 与前端约定中保持一致。

---

## 9. HITL 注册（实现清单）

- `hitl-config.ts`：`ai.image_caption_overlay`（及工具 1 的 `ai.vl_caption_regions`）。  
- `HitlConfirmBlock.tsx`：标题与自定义渲染入口。  
- 新前端组件：基于现有 `ImageWithBoundingBoxes` 思路，扩展为多行字幕框 + 四角缩放 + 字号 + **只读 ruby 预览**（无独立读音 IPC）。  
- `docs/architecture/hitl.md`：补充 action 与工具映射。

---

## 10. 测试要点

- VL 数组解析：`w/h` 缺省与齐全、归一化边界。  
- 像素转换与 clamp。  
- `**captionRubyLines` 与 VL `lines` 条数、`text` 与 `items` 拼接一致性**校验（失败抛错）。  
- HITL `merged` 为几何/字号真源；渲染与确认快照一致。  
- Skill 步骤顺序：叠字幕图进入 `finalize_workflow`。

---

## 11. 后续

- 实现阶段以 `docs/plans/2026-05-04-image-pinyin-overlay-implementation-plan.md` 为任务拆解依据。  
- 本规格变更应通过 PR 评审并同步 `docs/architecture/hitl.md`、`behavior-correction/SKILL.md`、`config.yaml`。

