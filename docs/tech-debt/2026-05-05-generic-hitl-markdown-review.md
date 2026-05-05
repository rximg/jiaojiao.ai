# 技术债：通用「需用户确认」流程（HITL Markdown 审阅）

## 背景

产品中多处需要 **AI 产出内容 → 用户明确确认 → 再执行后续工具**（例如：诗词定稿、绘本策划稿、参数摘要等）。若每种场景单独实现「聊天里打字确认」或重复封装工具，会出现：

- 交互不一致（有的要点按钮，有的要输入「确认」）；
- 难以审计与恢复（未走统一 HITL 通道时，无法与 checkpoint / `merged payload` 对齐）；
- 前端 `HitlConfirmBlock`、后端工具、`hitl-config` 的 **`actionType` 与分支持续膨胀**。

本议题登记为待重构项：**在现有 HITL 总线之上，抽出通用的「Markdown（或可编辑）审阅」契约**，业务按数据接入，而非复制样板。

## 现状（已有能力）

- **通用后端 primitive**：各工具通过 `ToolContext.requestApprovalViaHITL(actionType, payload)` 挂起，经 Electron `hitl:confirmRequest` / `hitl:respond`，合并 `payload` 后继续执行。与具体业务无关。
- **前端分发**：`src/app/components/HitlConfirmBlock.tsx` 按 `actionType` 渲染标题、正文、主/次按钮（含 `confirmText` / `cancelText`）。
- **已存在的「类通用」实例**：`request_story_plan_review` 使用 `story.plan_review`，实质为 **Markdown 正文 + 可选编辑 + 确认/取消**，与「古诗词定稿」等场景同构；但命名与外层标题偏「绘本策划」，复用时语义别扭。
- **策略表**：`backend/config/hitl-config.ts` 按 `actionType` 配置是否必须人工确认等。

关联阅读：[docs/architecture/hitl.md](../architecture/hitl.md)。

## 目标形态（建议）

1. **按「确认形态」收敛 `actionType`，而非按业务命名**  
   - 例如引入通用类型 **`hitl.markdown_review`**（名称可再议），语义为：展示 Markdown、可选 `allowEdit`、用户确认后返回合并后的 `markdownContent` 等字段。  
   - 诗词定稿、故事策划、其它「长文确认」共用同一类型，用 `title`、`reviewStage`（或 `scene`）区分场景与埋点。

2. **薄工具层**  
   - 提供单一工具（如 `request_markdown_review`）或工厂式封装，内部只调 `requestApprovalViaHITL('hitl.markdown_review', payload)`，避免业务工具重复拼 payload。

3. **前端**  
   - `story.plan_review` 的渲染分支与 **`hitl.markdown_review` 合并或委托**同一组件，避免两套 UI 漂移。  
   - 外层标题：优先使用 payload 中的 `title`，或按 `actionType` 配默认文案，避免古诗词场景仍显示「绘本故事策划稿」类固定映射（见当前 `ACTION_TITLE['story.plan_review']`）。

4. **迁移与兼容**  
   - 保留 `story.plan_review` 别名一段时间：内部映射到同一渲染与策略，或双注册规则，避免旧会话与旧 SKILL 断裂。  
   - `hitl-config`、白名单、文档同步更新。

5. **明确非目标**  
   - 图像画框、批量工具列表、VL 字幕区等高交互形态仍保留**独立 `actionType`**，不强行塞进 Markdown 通用类型，以免单组件无限膨胀。

## 收益

- 新业务（及 SKILL）**主要靠填 Markdown 与元数据**接入确认流，减少复制工具与 `switch` 分支。  
- 用户侧交互统一为「卡片 + 确认/取消（+ 可选编辑）」，与产品对「闸门」的预期一致。  
- 运维与策略配置集中在少数 `actionType` 上，更易理解与治理。

## 关联代码（重构时从这里下手）

| 区域 | 路径 |
|------|------|
| 策划稿审阅工具 | `backend/tools/request-story-plan-review.ts` |
| HITL 策略 | `backend/config/hitl-config.ts` |
| 确认卡片 UI | `src/app/components/HitlConfirmBlock.tsx` |
| HITL IPC | `electron/ipc/hitl.ts`、`backend/services/hitl-service.ts` |
| 典型消费方 SKILL | `backend/config/skills/story-book/SKILL.md`、`classic-poetry-book/SKILL.md`（若改为走统一工具） |

## 验收建议（偿还债务时）

- [ ] 至少一种通用 `actionType` + 工具 + 前端渲染路径可用，并有单元/集成测试覆盖 merged payload。  
- [ ] 现有 `story.plan_review` 会话或 SKILL 在无感迁移策略下仍可用。  
- [ ] `docs/architecture/hitl.md` 更新「通用 Markdown 审阅」契约与示例。  
- [ ] 本技术债文档可改为「已偿还」并链接至实现 PR 或 ADR（若后续引入）。

## 状态

**待排期**（登记日期：2026-05-05）。
