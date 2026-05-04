# 图片拼音字幕叠层（双工具 + HITL）设计规格

**日期**：2026-05-04  
**状态**：已根据产品拍板定稿，待实现与 `writing-plans` 拆解。

---

## 1. 目标与范围

- 在**已有插画 + 已定台词**的前提下，为每条台词在画面上找到合适字幕区，经 **HITL** 调整几何与文案后，将**汉字 + 拼音（拼音在上）**绘制到图上并落盘。
- **行为纠正** skill：在**台词生成之后、TTS 之前**完成画面定稿（甲），再进入配音与收尾。
- **Inference**：**不新增** `MultimodalPort` 方法；字幕区布局继续走现有 **`generateScriptFromImage`**（VL 大类），通过**独立 prompt 配置**区分「台词+点」与「字幕框+区域」；**注音**走现有 **LLM 同步推理**（非 VL），结构化输出。

---

## 2. 双工具划分

| 工具（拟注册名） | 职责 | HITL |
|------------------|------|------|
| `suggest_pinyin_caption_regions` | 调用 VL（`generateScriptFromImage` + 字幕区专用 `prompt`），解析为带几何的「行」列表 | **要**（与现 `generate_script_from_image` 类似：审图 + 可改 `userPrompt` 再跑 VL） |
| `annotate_image_with_pinyin` | 合并台词与区域 → **LLM 结构化注音**（预览/刷新）→ **叠字 HITL**（几何 + 字号 + 改字）→ 确认后 **再以最终文案做一次 LLM 注音** → Sharp+SVG 合成 | **要**（`ai.image_pinyin_overlay`） |

Agent 顺序：`generate_image` → 生成台词 → **`suggest_pinyin_caption_regions`** → **`annotate_image_with_pinyin`** → `batch_tool_call(generate_audio)` → `finalize_workflow`（`imagePath` 使用叠字成品）。

---

## 3. VL 扩展方式（仅 prompt + 类型/解析，不新增端口方法）

- **配置**：新增 `backend/config/tools/vl_caption_regions.yaml`（或等价路径），内含字幕区任务的系统提示词；工具 1 从该文件读取 `prompt` 传入 `generateScriptFromImage({ ..., prompt })`。
- **输出 JSON**：要求模型返回与现解析器兼容的**数组**，元素在 `text, x, y` 基础上增加 **`w`, `h`**（字幕框宽、高）。坐标系见第 4 节。
- **领域类型**：扩展 `ScriptLine`：`w?: number; h?: number`（可选，缺省时由工具层按默认矩形或规则兜底，具体在实现计划中写死）。
- **解析**：扩展 `parseVlScriptLinesFromModelContent`：若存在 `w`、`h` 则写入；否则仅 `text,x,y`。
- **工具 1 HITL**：复用或对齐 `ai.vl_script` 体验（图 + 可编辑补充说明）；payload 至少含 `imagePath`、`userPrompt?`、以及供界面展示的 **`lines`（台词）** 上下文。若与现 `ai.vl_script` payload 不完全一致，可在 `hitl-config` 中新增 `actionType`（例如 `ai.vl_caption_regions`）与专用标题，但**后端 VL 调用仍只走** `generateScriptFromImage`。

---

## 4. 坐标系（拍板由实现侧选定）

- **VL 输出**：**归一化**，`x, y, w, h` 均为 **0–1** 相对整幅图（左上原点，向右 x、向下 y；`w/h` 为相对宽高）。
- **工具层**：读图 `metadata` 后乘 `width/height` 转为**像素**，再交给 HITL 与渲染；越界按与 `annotate_image_with_numbers` 一致的 **clamp** 策略处理。

---

## 5. 工具 2：叠字 HITL 交互（已拍板）

- **几何**：平移；**四角拖动**改宽高；**不允许旋转**。
- **文字**：可改汉字内容；可改**字号**（建议：`hanziFontSizePx`、`pinyinFontSizePx` 或统一缩放因子，由实现选一种写入计划）。
- **注音展示**：进入 HITL 前及用户**改字后**需与 LLM 注音同步；首版推荐 **改字后节流自动重新请求 LLM 注音**（或「刷新拼音」按钮作兜底），避免确认前拼音与汉字长期不一致。**最终渲染仅以确认快照中的文案为准再调用一次 LLM 注音**（若与上次缓存一致可做短路优化，属实现优化非必须）。

---

## 6. LLM 结构化注音（无拼音库降级）

- **不**使用本地拼音库作为失败降级；**不**在失败时静默省略拼音（与「肯定能成功」前提一致；若解析失败则整次工具报错，由 Agent/用户重试）。
- **推荐 JSON 形状**（单次可包含多行）：

```json
{
  "lines": [
    {
      "index": 0,
      "items": [
        { "char": "宝", "pinyin": "bǎo" },
        { "char": "。", "pinyin": "" }
      ]
    }
  ]
}
```

- **约定**：
  - `char`：单个展示单位（以 **Unicode 标量** 为主；数字、字母可按一字一项或按产品再定）。
  - `pinyin`：**带声调**的汉语拼音（如 `bǎo`）；标点、空格等 **空字符串**。
  - 一行内 `items` 顺序与界面从左到右阅读顺序一致。

- **调用时机**：见第 5 节；**SKILL.md** 中写明：注音必须由 **LLM 结构化输出** 提供，且须在**最终确认文案**上再执行一次以保证与画面一致。

---

## 7. 渲染可调参数（默认 + 可选）

以下由 HITL `merged` 或工具默认提供，**有默认、可在界面或高级选项中调整**（首版可部分仅后端默认）：

| 参数 | 含义 | 默认建议 |
|------|------|----------|
| `hanziFontSizePx` / `pinyinFontSizePx` | 汉字与拼音字号 | 由设计稿给定一对基线值（如 28 / 14），可在 HITL 调整 |
| `fontFamily` | 字体栈 | `"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif` |
| `hanziColor` / `pinyinColor` | 填充色 | 深灰 / 略浅灰 |
| `textStrokeWidth` / `textStrokeColor` | 描边（压暗插画底） | 默认细描边 + 深半透明 |
| `boxBackgroundOpacity` | 可选圆角底衬不透明度 | 默认如 `0.75`；`0` 表示无底衬 |
| `boxPaddingPx` | 字与框边距 | 默认小 padding |

合成路径仍沿用 **`sharp` + SVG overlay**（与数字标注一致），具体 SVG 模板在实现计划中细化。

---

## 8. 行为纠正 Skill：Todo 项（5～6 项）

将原固定 4 项扩展为与步骤严格一致（文案与顺序需与前端进度约定联调），建议：

1. 生成双分镜图片  
2. 生成台词  
3. 字幕区布局（VL + HITL）— 对应工具 1  
4. 拼音叠字确认（HITL + 出图）— 对应工具 2  
5. 将台词合成语音  
6. 完成工作流并返回结果  

若产品希望合并 3–4 为一步展示，可改为 5 项，但须在 `SKILL.md` 与前端约定中保持一致。

---

## 9. HITL 注册（实现清单）

- `hitl-config.ts`：`ai.image_pinyin_overlay`（及工具 1 若不用 `ai.vl_script` 则需新 `actionType`）。  
- `HitlConfirmBlock.tsx`：标题与自定义渲染入口。  
- 新前端组件：基于现有 `ImageWithBoundingBoxes` 思路，扩展为多行文本块 + 四角缩放 + 字号 + 内联编辑 + 拼音预览行。  
- `docs/architecture/hitl.md`：补充 action 与工具映射。

---

## 10. 测试要点

- VL 数组解析：`w/h` 缺省与齐全、归一化边界。  
- 像素转换与 clamp。  
- LLM 注音 JSON 校验与 `lines`/`items` 一致性。  
- HITL `merged` 为唯一真源：改字、改框、改字号后渲染结果一致。  
- Skill 步骤顺序：叠字图进入 `finalize_workflow`。

---

## 11. 后续

- 实现阶段使用 **`writing-plans`** 产出 `docs/plans/` 下的任务拆解与文件级变更列表。  
- 本规格变更应通过 PR 评审并同步 `docs/architecture/hitl.md`、`behavior-correction/SKILL.md`、`config.yaml`。
