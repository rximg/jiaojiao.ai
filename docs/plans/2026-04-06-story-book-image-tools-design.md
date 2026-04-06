# Story-Book Image Tools Design

**Goal:** 在不改变 `story-book` 整体业务流程的前提下，用两个更贴近领域语义的工具替换当前 `SKILL.md` 中最重的图像编排描述，降低 `slot` / 四宫格切分 / 通用 `edit_image` 调用细节对 skill 的污染。

**Architecture:** 采用方案 B：引入一个强领域工具 `generate_character_sheet` 和一个薄领域工具 `generate_storyboard_page`。前者屏蔽四宫格角色图生成与切分动作，对外直接暴露按角色名命名的角色图结果；后者仍然接收 `imagePaths + prompt` 作为核心输入，但从语义上代表“生成单页分镜图”。同时保留 `story-book` 的步骤 3/4 边界，只重写其内部语义，并要求 `《绘本方案.md》` 升级为半结构化执行卡片文档，作为后续 tool 参数的唯一可读来源。

**Tech Stack:** `deepagents`, `LangChain` tools, `story-book` skill, 现有图像生成/图像编辑能力，`story-book` `SKILL.md` 对齐。

---

## 1. 背景与问题

当前 `story-book` skill 在图像阶段存在两个明显问题：

1. `角色图生成` 阶段泄漏了太多底层机制：
  - 先生成四宫格
  - 再调用 `split_grid_image`
  - 再建立 `slot1~slot4 -> 角色名` 映射
2. `分镜图生成` 阶段仍然强依赖对通用 `edit_image` 的详细操作说明：
  - `imagePaths` 顺序必须对应“参考图1/2/3”
  - 需要反复强调不要再使用 `slot`
  - skill 中混杂了业务规则与工具调用技巧

这导致：

- `SKILL.md` 过长，且有相当部分在解释“如何正确调用底层图像工具”
- 角色图和分镜页的业务语义没有被独立建模
- “四宫格切图”这种中间过程暴露给 agent，不利于后续演进

本设计的目标不是重做整套图像链路，而是收敛最脏的那部分约束，让 `story-book` 直接面向“角色图”和“分镜页”这两个业务动作工作。

---

## 2. 设计目标

本次设计只做以下事情：

1. 定义 `generate_character_sheet` 的职责与参数。
2. 定义 `generate_storyboard_page` 的职责与参数。
3. 给出 `story-book` `SKILL.md` 应如何改写以对齐这两个新工具。
4. 定义 `《绘本方案.md》` 应如何改成“人类可读、可直接指导 tool 参数提取”的半结构化执行文档。

本次设计明确**不包含**：

- 工具实现代码细节
- `backend/tools/` 的实际落地改动
- `config.yaml` 调整细节
- 运行时状态、manifest、恢复逻辑的进一步重构
- 对其他 skill 的联动改造

换句话说，这是一份**以 `story-book` skill 与 `《绘本方案.md》` 模板对齐为中心**的工具抽象设计，而不是完整实施方案。

---

## 3. 选型结论

本设计采用 **方案 B：半领域工具**。

### 3.1 为什么不是方案 A

方案 A 的关键是让 `generate_storyboard_page` 接收更高层的业务参数，例如角色名、方案页码、结构化场景信息，再由工具内部自己完成图片路径解析与 prompt 组装。

本轮没有选择这条路线，原因是：

- 当前共识是 `generate_storyboard_page` **仍然传图片路径**
- 当前共识是 `generate_storyboard_page` **直接传完整最终 prompt**
- 工具内部不承担复杂的业务推导与 prompt 合成

因此，方案 A 的“高层业务编排”优势本轮并不成立。

### 3.2 为什么不是方案 C

方案 C 是只修改 skill 文案，不真正定义两个清晰的新工具边界。这样虽然能暂时统一叙述，但很容易变成“名义上有新工具，实际上还是老的通用图像调用逻辑”，收益有限。

### 3.3 为什么选择方案 B

方案 B 最符合当前边界：

- `generate_character_sheet`：强领域封装
- `generate_storyboard_page`：薄领域封装

它的优点是：

- 真正屏蔽掉四宫格切分和 `slot` 机制
- 仍保留 agent 对分镜 prompt 的创作控制
- skill 可以显著简化，但不需要把太多业务推导塞进工具内部

---

## 4. 工具边界

## 4.1 `generate_character_sheet`

### 职责

`generate_character_sheet` 负责完整承接“角色参考图生成”这件事：

1. 接收角色列表与角色描述
2. 生成一张 2x2 四宫格角色图
3. 内部完成切图
4. 以角色名输出单角色参考图
5. 返回角色名与角色图文件路径的结果

对 `story-book` skill 来说，这个工具的最大价值是：

- **隐藏四宫格**
- **隐藏 `split_grid_image`**
- **隐藏 `slot1~slot4`**

skill 不再需要知道中间切图过程，只需要知道“已经得到了按角色名命名的参考图”。

### 非职责

它**不负责**：

- 生成分镜页 prompt
- 推导后续分镜该使用哪些角色
- 维护跨会话的显式角色 manifest（这可作为后续增强）

### 推荐参数

建议输入采用结构化角色列表，而不是一大段原始文本。

```ts
type GenerateCharacterSheetInput = {
  characters: Array<{
    roleName: string;
    description: string;
  }>;
  imageName?: string;
  size?: string;
  style?: string;
  model?: string;
  sessionId?: string;
};
```

### 参数说明

- `characters`
  - 必填
  - 由 skill 在方案阶段基于 `绘本方案.md` 中的角色设定生成
  - 每个元素至少包含：
    - `roleName`
    - `description`
  - `description` 应是可直接用于角色图生成的完整角色描述，至少包含外观锚点、服饰、配饰、年龄感、表情基调等信息
- `imageName`
  - 可选
  - 用于四宫格总图命名，默认可为 `character_sheet_4grid.png`
- `size`
  - 可选
  - 四宫格图整体尺寸
- `style`
  - 可选
  - 角色图整体画风
- `model`
  - 可选
  - 图像生成模型
- `sessionId`
  - 可选
  - 使用当前会话为默认值

### 推荐输出

```ts
type GenerateCharacterSheetOutput = {
  sheetImagePath: string;
  roleImages: Array<{
    roleName: string;
    imagePath: string;
  }>;
};
```

### 输出语义

- `sheetImagePath`
  - 四宫格总图路径
  - 在前端聊天流中，复用现有图片展示控件，作为本次 `generate_character_sheet` 的主回显图片
  - 对分镜阶段而言，它主要用于人工查看与回溯，不要求 skill 在后续步骤中继续使用
- `roleImages`
  - 真正给后续分镜使用的结果
  - 每个角色直接对应一张单角色参考图
  - 文件命名应与 `roleName` 对齐，例如 `images/rabbit_mom.png`
  - 这些单角色图主要进入工作区文件列表，供后续 `generate_storyboard_page` 选取，不要求在聊天流中逐张展开显示

### 关键约束

1. 对外不暴露 `slot1~slot4`。
2. 对外不要求调用 `split_grid_image`。
3. skill 后续只使用角色名与角色图路径，不再使用中间切图概念。

---

## 4.2 `generate_storyboard_page`

### 职责

`generate_storyboard_page` 表示“生成单页分镜图”的业务动作。

它的职责刻意保持薄封装：

1. 接收当前页最终 prompt
2. 接收当前页需要的参考图路径
3. 调用底层图像编辑/图像生成能力完成单页分镜图产出

它的核心价值不是替 agent 完成复杂业务推理，而是：

- 用一个业务名词替代通用 `edit_image`
- 让 `story-book` 的分镜步骤不再直接暴露“我在调用通用图像编辑工具”

### 非职责

它**不负责**：

- 自动从角色名解析图片路径
- 自动组装 prompt
- 自动判断当前页哪些角色应出场
- 自动从 `绘本方案.md` 提取分镜内容

这些仍然由 skill 和 agent 在“读取方案执行卡片 -> 生成最终 prompt -> 选择当前页参考图”的链路中负责。

### 推荐参数

```ts
type GenerateStoryboardPageInput = {
  prompt: string;
  imagePaths: string[];
  imageName?: string;
  size?: string;
  model?: string;
  promptExtend?: boolean;
  watermark?: boolean;
  sessionId?: string;
};
```

### 参数说明

- `prompt`
  - 必填
  - 由 skill 基于方案内容生成的**完整最终 prompt**
  - 其中必须包含当前页场景、动作、情绪、镜头、风格，以及“参考图1/2/3 分别对应谁”的描述
- `imagePaths`
  - 必填
  - 当前页实际出场角色的参考图路径
  - 顺序必须与 `prompt` 中的“参考图1/2/3”一致
- `imageName`
  - 可选
  - 当前页输出文件名，例如 `scene_4.png`
- `size`
  - 可选
  - 输出尺寸
- `model`
  - 可选
  - 模型名
- `promptExtend`
  - 可选
  - 是否允许模型侧扩展 prompt
- `watermark`
  - 可选
  - 是否加水印
- `sessionId`
  - 可选
  - 当前会话 ID

### 推荐输出

可以保持与现有图像编辑结果相近，避免额外引入复杂语义：

```ts
type GenerateStoryboardPageOutput = {
  imagePath: string;
  imageUri?: string;
};
```

### 输出语义

- `imagePath`
  - 当前页分镜图路径
  - 在前端聊天流中，复用现有图片展示控件，直接作为本次 `generate_storyboard_page` 的主回显图片
- `imageUri`
  - 可选的附加访问字段
  - 不作为本轮设计的前端依赖前提

### 关键约束

1. 它虽然是新工具，但本质上仍是“单页分镜图生成”接口，而不是高层业务控制器。
2. 该工具不隐藏 `imagePaths`，因为当前设计共识是：调用方仍然显式传入图片路径。
3. skill 中仍需保留“只传当前页实际出场角色”“参考图顺序与 prompt 一致”这类业务约束。

---

## 5. `story-book` `SKILL.md` 的改写原则

## 5.1 应删除的内容

`story-book` `SKILL.md` 中以下内容应被删除或显著收缩：

1. 对 `split_grid_image` 的显式调用要求
2. `slot1~slot4` 只是中间命名的解释
3. “切图完成后建立角色名 -> 图片路径映射”的中间过程说明
4. 大段围绕“不要再用 slot 驱动分镜”的操作性解释
5. 把 `edit_image` 当作主要分镜工具的表述

这些内容之所以可以删除，是因为：

- 角色图阶段的中间机制已由 `generate_character_sheet` 封装
- 分镜阶段已有业务名词工具 `generate_storyboard_page`

## 5.2 必须保留的内容

以下内容仍然应该保留在 skill 中：

1. `绘本方案.md` 是唯一事实源
2. 用户确认方案前不得进入图像与音频生成
3. 分镜页 prompt 必须直接基于方案，不得临时改写故事结构
4. 当前页只传入当前页实际出场角色的图片
5. `imagePaths` 顺序必须与 prompt 中“参考图1/2/3”一致
6. prompt 中要明确说明“参考图1为谁、参考图2为谁”
7. `《绘本方案.md》` 必须包含完整指导 tool 参数提取的半结构化执行卡片

也就是说，本轮改写不等于把所有图像规则都从 skill 中删光，而是：

- 删除中间机制
- 保留业务约束

## 5.3 工具清单调整

`Allowed Tools` 需要对齐成新的图像工具语义：

- 移除：`split_grid_image`
- 移除：`edit_image`
- 增加：`generate_character_sheet`
- 增加：`generate_storyboard_page`

其余工具保持不变：

- `write_file`
- `edit_file`
- `request_story_plan_review`
- `write_todos`
- `generate_audio`
- `batch_tool_call`
- `finalize_workflow`

## 5.4 步骤 3 的改写方向

当前步骤 3 从：

- 生成四宫格角色图
- 切分角色图
- 建立映射

改成：

- 根据 `《绘本方案.md》` 中的“角色参考图执行卡片”，整理角色名与角色描述
- 调用 `generate_character_sheet`
- 直接获得按角色名命名的角色参考图
- 后续所有分镜页仅使用这些角色图

建议将步骤标题改成更贴近新工具的表达，例如：

- `步骤 3：生成角色参考图`

而不再强调“四宫格”和“切图”。

这里要特别强调：**步骤 3 不删除，也不与步骤 4 合并。**  
虽然 `slot` 逻辑被移除了，但“先建立稳定角色参考图，再基于这些角色图生成分镜页”仍然是两个不同的业务阶段，应继续保留在 skill 中。

## 5.5 步骤 4 的改写方向

当前步骤 4 从：

- 直接使用 `edit_image`
- skill 解释如何组织 `imagePaths`

改成：

- 使用 `generate_storyboard_page`
- 从 `《绘本方案.md》` 中每页的“分镜执行卡片”提取当前页执行信息
- 仍要求 agent 自己生成完整最终 prompt
- 仍要求 agent 自己只选择当前页实际出场角色的 `imagePaths`

建议将步骤 4 的核心表述改成：

1. 从 `《绘本方案.md》` 的当前页分镜执行卡片中读取执行信息。
2. 生成当前页完整最终 prompt。
3. 只传入当前页实际出场角色的参考图路径。
4. 调用 `generate_storyboard_page` 生成单页分镜图。

## 5.6 `SKILL.md` 需要新增的原则

除了工具替换外，`story-book` `SKILL.md` 还应新增一条明确原则：

> `《绘本方案.md》` 必须是可执行方案文档，而不是纯策划摘要。  
> 其中必须包含完整指导 tool 参数提取的半结构化执行卡片。  
> agent 在执行角色图、分镜图、音频阶段时，只能从这些执行卡片中提取参数，不得在执行阶段临时重新发明字段结构或补写关键约束。

这条原则的目的是把“参数来源”前置到方案确认阶段，而不是在真正执行 tool 时再临时补齐。

---

## 6. `《绘本方案.md》` 的新结构

## 6.1 文档角色变化

旧结构下，`《绘本方案.md》` 更像策划文档，虽然包含很多执行信息，但图像部分仍有一部分是“人类描述 + skill 解释 + agent 二次整理”。

新结构下，`《绘本方案.md》` 应升级为：

- 人类可读
- 不暴露不可读的具体函数调用
- 但字段足够完整，能直接指导 tool 参数提取

也就是一份**半结构化执行文档**。

## 6.2 角色参考图执行卡片

建议新增或重写为一个明确区块，例如：

```markdown
## 角色参考图执行卡片

- 使用工具：角色参考图生成
- 输出目标：为主要角色生成独立参考图，文件名与角色名对应
- 整体画风：...
- 输出尺寸：...

### 角色列表
#### 角色：兔妈妈
- 角色描述：...

#### 角色：小兔
- 角色描述：...
```

这个区块的作用是：

- 对人类可读
- 对 agent 可提取
- 足够覆盖 `generate_character_sheet.characters[]`、`style`、`size` 等核心入参
- 不出现不可读的 JSON 或函数调用文本

## 6.3 逐页分镜执行卡片

每页建议采用统一卡片结构，例如：

```markdown
### 第3页：森林相遇

#### 分镜执行卡片
- 使用工具：分镜页生成
- 出场角色：
  - 兔妈妈
  - 小兔
- 参考图顺序：
  - 参考图1：兔妈妈
  - 参考图2：小兔
- 输出文件：`images/scene_3.png`
- 输出尺寸：1472*1104
- 分镜 prompt：...
- 约束：
  - 未出场角色不得入镜
  - 完整复刻参考角色外观锚点
```

这个区块的作用是：

- 直接指导 `generate_storyboard_page` 的参数提取
- 明确当前页只应传哪些角色图
- 明确 `imagePaths` 顺序如何与 prompt 对齐
- 仍保持文档对人类可读

## 6.4 不应出现的内容

新结构下，`《绘本方案.md》` 不应再出现：

- 具体函数调用文本，如 `generate_storyboard_page({...})`
- 原始 JSON 参数块
- `slot1~slot4`
- “先切图再映射”这类中间机制描述

也就是说，方案文档要**指导调用**，但不能**直接展示不可读调用语法**。

---

## 7. 对 `story-book` skill 的推荐改写结果

下面是方向性结论，而不是最终逐行改稿：

### 7.1 角色阶段应如何表达

skill 应描述为：

- “根据 `《绘本方案.md》` 的角色参考图执行卡片，整理出角色名和角色描述”
- “调用 `generate_character_sheet`”
- “获得按角色名命名的角色图”
- “后续分镜页仅使用这些角色图”

skill **不应再描述**：

- 四宫格内部布局
- `slot1~slot4`
- 调用 `split_grid_image`

### 7.2 分镜阶段应如何表达

skill 应描述为：

- “根据 `《绘本方案.md》` 中每页分镜执行卡片生成该页最终 prompt”
- “prompt 中要明确参考图 1/2/3 分别是谁”
- “只传入当前页实际出场角色的图片路径”
- “调用 `generate_storyboard_page`”

skill **不应再描述**：

- 这是在调用 `edit_image`
- 如何理解四宫格切图
- `slot` 与角色名的中间映射关系

### 7.3 仍然保留的 skill 负担

即使采用方案 B，skill 仍然要承担以下职责：

- 从 `《绘本方案.md》` 中提炼每页 prompt
- 决定当前页需要哪些角色图
- 确保 `imagePaths` 顺序与 prompt 一致

这是方案 B 的本质取舍：

- 让 skill 变干净一些
- 但不把所有业务编排都下沉到工具层

---

## 8. 风险与取舍

## 8.1 优点

1. `story-book` skill 会明显更短、更聚焦业务流程。
2. `slot`、切图、四宫格等中间机制从 skill 中移除。
3. 角色图与分镜页有了清晰的业务工具名词。
4. `generate_character_sheet` 真正屏蔽了一个高复杂度中间过程。

## 8.2 代价

1. `generate_storyboard_page` 仍然是薄封装，不能彻底解决角色图选择和 prompt 组织责任仍在 skill 中的问题。
2. skill 仍需保留“只传当前页角色”“参考图顺序一致”这类业务约束。
3. 由于前端展示层复用现有图片控件，而不新增专用卡片，tool 的差异主要体现在调用语义与返回结构上，而不是视觉组件上。
4. 如果未来想进一步做恢复、局部重做、自动校验，可能仍需引入更强的运行时控制状态或更高层工具。

## 8.3 前端展示结论

本轮设计不新增专用前端卡片组件，而是复用现有图片展示能力：

- `generate_character_sheet` 在聊天流中展示四宫格总图。
- `generate_storyboard_page` 在聊天流中展示单页分镜图。
- 角色单图和分镜图文件仍通过工作区文件列表统一承载。
- 两个 tool 的统一性体现在“都是图片产物”，差异体现在业务语义，而不是前端视觉形态。

## 8.4 适用性判断

对于当前项目阶段，这个取舍是合理的：

- 它比现状更清晰
- 但又不强迫工具承担过多编排逻辑
- 实施成本明显低于高层业务工具方案

---

## 9. 后续实施建议

如果后续进入实现阶段，建议按这个顺序推进：

1. 先实现 `generate_character_sheet`
2. 再实现 `generate_storyboard_page`
3. 重写 `《绘本方案.md》` 模板结构
4. 最后对齐 `story-book` 的 `SKILL.md`

原因：

- `generate_character_sheet` 是这轮收益最大的工具，能先消掉最脏的中间机制
- `generate_storyboard_page` 只是薄封装，后续对齐成本更低
- 方案文档模板是 skill 参数来源的上游，需要先明确
- 先有工具和模板，再改 skill，能避免 skill 文案与实现短期失配

不过如果当前目标是先写设计和未来规范，那么 `SKILL.md` 可以先按目标接口改写，但需要在文档和实施计划中明确：

> skill 将先对齐目标接口，实际工具实现随后补齐。

---

## 10. 最终结论

本设计建议：

1. 采用 **方案 B**。
2. 用 `generate_character_sheet` 彻底屏蔽四宫格和切图过程。
3. 用 `generate_storyboard_page` 作为分镜页的薄领域工具，保留 `imagePaths + prompt` 调用方式。
4. 保留步骤 3/4 边界，只重写其内部语义，不做阶段合并。
5. 将 `《绘本方案.md》` 改成半结构化执行文档，作为后续 tool 参数的唯一可读来源。
6. 前端不新增专用卡片组件，统一复用现有图片展示控件：角色工具回显四宫格总图，分镜工具回显单页分镜图。
7. 改写 `story-book` `SKILL.md`，删除中间图像机制描述，只保留业务流程、参数来源规则与页面级约束。
8. 本轮设计的重点是 **skill 与方案文档共同对齐目标接口**，而不是把所有业务编排都塞进工具内部。

