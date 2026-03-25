# Markdown 编辑上下文注入设计

**日期：** 2026-03-25

## 背景

当前 `story.plan_review` 的 Markdown 人工确认链路，前端支持编辑后再确认，但编辑结果进入 LLM 上下文的方式仍然过于粗糙：

- 直接回传全文会浪费 token
- 只做简单 diff 又难以表达用户真正修改的业务意图
- 会话恢复时，后续轮次也缺少对“用户曾经如何修改文档”的稳定认知

本设计只解决一种场景：**前端 HITL 中可编辑 Markdown 文档，在用户确认后，如何把编辑结果以适合 LLM 消费的形式同时注入当前轮和后续会话。**

## 目标

建立一套仅面向 Markdown 文档的编辑上下文注入机制，满足以下要求：

1. 用户在前端编辑 Markdown 后，系统可以识别相对基线版本的变化
2. 小改动优先向 LLM 注入“结构化摘要 + 局部 diff”
3. 大改动自动降级为“结构化摘要 + 最新全文”
4. 编辑结果同时进入：
   - 当前轮继续执行的 agent 上下文
   - 会话级持久化上下文
5. 不引入 Git，不做通用版本控制，不覆盖图片、音频、二进制等非文本文件

## 范围

### 第一阶段覆盖范围

- 仅覆盖前端 HITL 中的 Markdown 编辑确认
- 首个落地对象为 `story.plan_review`
- 仅处理 `.md` 文档

### 非目标

- 不覆盖所有文件编辑工具
- 不覆盖图片、音频、PDF、二进制文件
- 不做 Git 风格历史管理
- 不做跨进程、跨重启的完整版本恢复系统
- 不在前端实现 diff 或摘要算法

## 当前契约现状与迁移目标

当前 `story.plan_review` 相关链路仍停留在“由工具直接传入 Markdown 正文”的旧契约上，不能满足“前端按文件路径读取并展示 Markdown，再在确认后触发编辑上下文构建”的目标。

### 当前旧契约

当前链路实际是：

- skill 要求模型调用 `request_story_plan_review(filePath, title, markdownContent, ...)`
- tool schema 强制 `markdownContent` 为必填参数
- 前端 `HitlConfirmBlock` 直接消费 payload 中的 `markdownContent`

这意味着当前实现是“工具把 Markdown 正文塞进 payload，前端直接显示 payload”，而不是“前端根据 `filePath` 读取工作区文件后展示”。

### 目标新契约

第一阶段设计应迁移为 path-based contract：

- tool 调用改为 `request_story_plan_review(filePath, title, confirmText, cancelText, ...)`
- 前端根据 `filePath` 读取 workspace 中的 Markdown 文件并渲染
- 若用户编辑，前端确认时回传编辑结果，由后端统一负责比对、摘要、降级和会话注入

### 为什么这一步必须纳入本设计

如果不先完成从 `markdownContent` 直传到 `filePath` 驱动的契约迁移，则后续的 `MarkdownEditBaselineStore` / `MarkdownEditContextBuilder` / `MarkdownEditContextProjector` 只能建立在旧 payload 契约上，无法形成一致的数据流边界。

因此，本设计除了定义“编辑后的 Markdown 如何注入 LLM 上下文”，还必须显式覆盖 `story.plan_review` 的契约迁移。

## 方案选择

采用“方案 2”：**结构化编辑摘要为主，diff 为辅，必要时全文回退。**

相对候选方案的取舍如下：

1. 不采用“仅 diff / 全文二选一”为主格式
原因：逐行 diff 无法稳定表达用户的真实编辑意图，特别是标题重排、章节改写、目标年龄变化、故事主题变化等语义层调整。

2. 不采用“始终只注入最新全文”
原因：长 Markdown 会显著抬高 token 开销，也会丢失“本次是怎么改出来的”这一重要上下文。

3. 采用“摘要 + diff/full”的混合格式
原因：既保留 token 效率，又保留可解释性，适合 LLM 在继续执行任务时快速抓住编辑意图。

## 总体架构

系统新增一条专用链路，位于“前端编辑确认”与“agent 继续执行”之间。

### 组件划分

#### 1. MarkdownEditBaselineStore

职责：

- 在一次 Markdown HITL 请求创建时记录基线内容
- 以 `sessionId + requestId + filePath` 定位唯一编辑基线
- 为确认阶段提供可比对的原始内容和哈希

建议保存内容：

```ts
interface MarkdownEditBaseline {
  sessionId: string;
  requestId: string;
  filePath: string;
  baselineContent: string;
  baselineHash: string;
  createdAt: string;
}
```

存储策略：

- 第一阶段：后端内存存储
- 增强方案：同步到 session workspace 中的 metadata 文件，降低进程重启后的基线丢失影响

#### 2. MarkdownEditContextBuilder

职责：

- 在用户点击确认后比对 `baselineContent` 与 `editedContent`
- 生成结构化摘要
- 计算局部 diff
- 决定采用 `summary_diff` 还是 `summary_full`
- 输出统一的 `MarkdownEditContextPacket`

#### 3. MarkdownEditContextProjector

职责：

- 将 `MarkdownEditContextPacket` 注入当前轮执行上下文
- 将 `MarkdownEditContextPacket` 写入会话级持久化存储
- 控制保留条数与后续轮次的读取策略

#### 4. StoryPlanReview Contract Adapter

职责：

- 将 `story.plan_review` 从旧的 `markdownContent` 直传契约迁移到新的 `filePath` 驱动契约
- 保证工具层、前端层、确认回传层的数据边界一致
- 为后续 Markdown 编辑上下文机制提供统一入口

该适配层不是长期存在的独立服务，而是一个设计概念：实际实现会分散在 skill、tool schema、前端渲染与确认回传逻辑中。

## 核心数据契约

统一上下文包定义如下：

```ts
interface MarkdownEditContextPacket {
  kind: 'markdown_edit_context';
  sessionId: string;
  requestId: string;
  filePath: string;
  baselineHash: string;
  currentHash: string;
  strategy: 'summary_diff' | 'summary_full';
  summary: {
    changedSections: string[];
    addedRequirements: string[];
    removedRequirements: string[];
    semanticChanges: string[];
    userIntent: string;
  };
  diffText?: string;
  fullContent?: string;
  generatedAt: string;
}
```

字段语义：

- `summary`：LLM 主消费内容
- `diffText`：小改动时的辅助材料
- `fullContent`：大改动时的回退材料
- `strategy`：明确当前使用哪种注入策略
- `baselineHash / currentHash`：用于版本校验、去重和调试

前端确认回传数据建议调整为：

```ts
interface StoryPlanReviewApprovalPayload {
  filePath: string;
  editedContent: string;
}
```

相应地，请求阶段的 payload 建议收敛为：

```ts
interface StoryPlanReviewRequestPayload {
  filePath: string;
  title?: string;
  confirmText?: string;
  cancelText?: string;
}
```

设计原则：

- 前端只提交编辑结果
- 后端统一做比对、摘要、降级和投影
- 不在前端做上下文策略判断
- 请求阶段不再传递 `markdownContent`

## 详细数据流

### 阶段 1：发起可编辑 Markdown 确认

1. 工具层发起 `story.plan_review`
2. tool payload 仅包含 `filePath`、`title`、`confirmText`、`cancelText` 等元信息，不再包含 `markdownContent`
3. 后端读取 `filePath` 对应的当前 Markdown 文件内容
4. 后端将该内容写入 `MarkdownEditBaselineStore`
5. 后端向前端发送可编辑 HITL 请求
6. 前端根据 `filePath` 读取并展示 Markdown 内容

此时，前端展示的内容与后端 baseline 保持一致。

### 阶段 2：用户编辑并确认

1. 用户在前端编辑 Markdown
2. 用户点击确认
3. 前端回传：

```json
{
  "filePath": "绘本故事策划稿.md",
  "editedContent": "...最新 Markdown 全文..."
}
```

4. 后端根据 `requestId` 找回 baseline
5. 后端调用 `MarkdownEditContextBuilder` 生成上下文包

这里明确采用“路径 + 编辑结果模式”，而不是“只回传 filePath”。

原因：

- 若允许前端编辑，后端必须拿到编辑结果才能构建差异上下文
- 若只回传 `filePath`，则必须由前端先完成文件写回，再由后端重新读取；这会把“基线对比”和“文件更新”顺序耦合在一起，增加冲突和调试复杂度
- 当前设计中，前端只提交 `editedContent`，后端统一负责比对、摘要、回写与注入，更符合职责分离原则

### 阶段 3：当前轮强注入

后端恢复 agent 执行后，将 `MarkdownEditContextPacket` 转成固定格式的系统上下文提示，直接注入本轮继续执行上下文。

小改动示例：

```text
用户已确认并编辑 Markdown 文档：绘本故事策划稿.md

编辑摘要：
- 修改章节：故事主题、故事大纲
- 新增要求：目标年龄改为 5 岁；整体风格更温馨
- 删除要求：删去“积极向上”的表述
- 语义变化：故事主题从“学习爬树”调整为“学习分享”

以下为精简差异：
[diffText]
```

大改动示例：

```text
用户已确认并大幅修改 Markdown 文档：绘本故事策划稿.md

编辑摘要：
- 修改章节：全文结构重写
- 语义变化：故事主题、角色设定、页数规划均已变更
- 建议：后续步骤必须以新文档为唯一事实源

以下为当前最新全文：
[fullContent]
```

### 阶段 4：会话级沉淀

当前轮继续执行后，系统还需要将 `MarkdownEditContextPacket` 持久化到 session metadata 中，供后续轮次继续可见。

建议新增文件：

- `meta/markdown-edit-contexts.json`

存储结构：

```ts
interface StoredMarkdownEditContexts {
  items: MarkdownEditContextPacket[];
}
```

后续新一轮输入构建时：

- 优先读取最近一次与当前任务相关的 Markdown 编辑上下文
- 若与当前步骤强相关，则一并注入
- 不需要每轮无差别注入全部历史记录

## 摘要生成规则

`summary` 是主输入，因此需要比普通 diff 更稳定的提取策略。建议优先从 Markdown 结构入手，而非逐行文本。

### 1. changedSections

通过比对标题层级与正文内容变化，收集发生变化的章节名，例如：

- 故事主题
- 故事大纲
- 故事角色
- 第 3 页

### 2. addedRequirements

提取新增的业务要求，例如：

- 新增目标年龄为 5 岁
- 新增“更温馨”的风格要求
- 新增旁白口吻更简短的要求

### 3. removedRequirements

提取被删除的业务要求，例如：

- 删除原先的“积极向上”风格约束
- 删除第 6 页的配角出场要求

### 4. semanticChanges

提取需要显式告知模型的语义变化，例如：

- 主角成长主题改为“学会分享”
- 页数规划从 12 页变为 8 页
- 角色设定从 4 个改为 3 个主要角色

### 5. userIntent

这是摘要中最重要的总括句，用一句话概括“用户这次想改什么”。例如：

- 用户重写了故事主题和整体风格，希望后续生成链路基于新的温馨分享主题继续执行。

## 降级策略

不采用单一“超过 50% 改动就全文回退”的策略，而采用多条件组合判断。

### 条件 1：行变更比例

- 默认阈值：`> 50%`
- 用于粗判是否为大改动

### 条件 2：diff 体积

- 默认阈值：`> 12KB` 或 `> 200 行`
- 即使变更比例未超，只要 diff 太长也降级为全文

### 条件 3：Markdown 结构重排

以下情况直接判定为大改动：

- 一级或二级标题大面积变化
- 章节顺序重排
- 页面段落整体迁移

### 条件 4：语义重写信号

如果摘要器识别出以下信号，也应直接采用 `summary_full`：

- 全文重写
- 故事主题改变
- 结构重组
- 页数方案重做

### 最终策略

- 小改动：`summary_diff`
- 中等改动但 diff 冗长：`summary_full`
- 大改动：`summary_full`

## 会话级保留策略

避免长期累积过多编辑上下文，建议限制为：

- 全局仅保留最近 `3` 条 packet
- 同一 `filePath` 仅保留最近 `2` 条 packet

注入时机建议：

1. 当前轮：无条件强注入本次 packet
2. 后续轮：只读取最近一次与当前 Markdown 文件直接相关的 packet

这样可以平衡“上下文连续性”和“token 控制”。

## 错误处理

### 1. 基线丢失

场景：

- 后端进程重启
- requestId 找不到对应 baseline

处理：

- 直接退化为 `summary_full`
- 以 `editedContent` 为当前唯一事实源
- 记录告警日志

### 2. 文件外部变更冲突

场景：

- 用户编辑期间，磁盘上的 Markdown 又被其他流程改写

处理：

- 仍以用户确认时的 `editedContent` 为准
- packet 中记录冲突标记
- 摘要中增加“编辑期间检测到外部改动，当前已以用户确认版本为准”

### 3. 无实际变更

场景：

- 用户打开编辑器但未修改内容

处理：

- 不生成 packet
- 当前轮只记录“用户已确认，无编辑变更”

### 4. diff 生成失败

处理：

- 直接退化为 `summary_full`

### 5. 摘要生成失败

处理：

- 使用模板化摘要兜底：
  - 修改章节
  - 行数变化
  - 当前采用全文回退

## 与现有仓库的集成点

### 前端

- `src/app/components/HitlConfirmBlock.tsx`
  - 当前已经具备 Markdown 排版渲染能力，可复用 `MarkdownDocumentBlock`
  - 契约迁移后需将 Markdown 数据源从 `payload.markdownContent` 切换为按 `filePath` 读取的文件内容
  - 从 `filePath` 读取并展示 Markdown
  - 编辑后提交 `filePath + editedContent`

- `src/providers/ChatProvider.tsx`
  - 负责将确认 payload 回传给后端

### Skill / Tool 契约层

- `backend/config/skills/story-book/SKILL.md`
  - 需移除 `request_story_plan_review` 对 `markdownContent` 的调用要求
  - 改为仅要求传 `filePath`、`title` 与编辑开关等元信息

- `backend/tools/request-story-plan-review.ts`
  - 需从 tool params 与 zod schema 中删除 `markdownContent`
  - 改为只传递 path-based request payload

### 后端

- `backend/tools/request-story-plan-review.ts`
  - 作为 `story.plan_review` 的入口

- `backend/services/hitl-service.ts`
  - 负责接收前端确认后的 payload

- `backend/application/agent/invoke-agent-use-case.ts`
  - 作为当前轮输入构建和后续上下文注入的主要接入点

- `backend/application/agent/update-session-use-case.ts`
  - 用于持久化 `meta/markdown-edit-contexts.json`

- `backend/services/workspace-checkpoint-saver.ts`
  - 用于与现有 checkpoint 恢复链路协同，但不承担编辑上下文主存储职责

## 测试设计

### 0. 契约迁移测试

覆盖：

- skill 文案不再要求调用 `request_story_plan_review` 时传 `markdownContent`
- tool schema 不再要求 `markdownContent`
- 前端在 `story.plan_review` 分支下从 `filePath` 读取 Markdown 内容
- 前端确认时回传 `filePath + editedContent`

### 1. Builder 单元测试

覆盖：

- 无变更
- 小改动生成 `summary_diff`
- 大改动生成 `summary_full`
- 标题重排触发全文回退
- diff 超长触发全文回退

### 2. BaselineStore 单元测试

覆盖：

- 保存基线
- 读取基线
- 覆盖旧 request
- 消费后清理

### 3. Projector 单元测试

覆盖：

- 当前轮注入内容格式正确
- session 持久化结构正确
- 保留条数正确

### 4. HITL 集成测试

覆盖：

- 前端编辑 Markdown 后确认
- 后端收到 `editedContent`
- 生成 packet
- 当前轮后续 agent 收到注入上下文
- 会话重开后仍能读取最近编辑上下文

## 分阶段落地建议

### Phase 1

- 仅支持 `story.plan_review`
- 仅支持 Markdown
- 基线存内存
- packet 持久化到 session metadata

### Phase 2

- 增强摘要质量
- 提高结构重排识别能力
- 对基线做 session 级落盘，提升抗重启能力

### Phase 3

- 在明确收益后，再评估是否扩展到 YAML / JSON / 代码文件

## 最终结论

这套机制不应被定义为“所有文件编辑统一机制”，而应被定义为：

**面向前端 HITL Markdown 编辑的上下文注入机制。**

它的核心不是保存旧文件副本，而是：

1. 保存基线快照
2. 生成结构化编辑摘要
3. 用 diff 或全文作为辅助材料
4. 同时注入当前轮和会话级上下文

这比“简单复制旧文件 + 50% 阈值”更适合当前仓库，也更适合 LLM 消费。