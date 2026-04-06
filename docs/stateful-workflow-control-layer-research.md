# Stateful Workflow / 控制层调研报告

**项目：** `jiaojiao`  
**日期：** `2026-04-06`

---

## 1. 调研目标

本报告聚焦这个项目里常说的 Stateful Workflow / 控制层能力：

- 阶段转换
- 重试策略
- 补偿操作
- 人工审批节点
- 长任务的状态持久化与恢复

目标不是泛泛介绍 `deepagents`、`LangChain`、`LangGraph`，而是回答三个更具体的问题：

1. 当前仓库里，这些能力到底落在哪些模块上。
2. 哪些是底层框架直接提供的，哪些是项目自己实现的。
3. 这种实现方式是否接近最佳实践，社区还有哪些经典替代方案。

---

## 2. 结论摘要

先给结论：

1. 这个项目**已经具备“可恢复的状态化智能体流程”雏形**，但它的控制层并不是一个“显式工作流引擎”，而更像是**`deepagents + LangGraph` 提供耐久执行底座，项目自己用 Skill 提示词、工具、HITL 服务和 workspace 持久化拼出业务流程**。
2. **长任务持久化/恢复**这一块，最核心的底座来自 **LangGraph checkpointer 机制**；项目自己实现了 `WorkspaceCheckpointSaver`，把 checkpoint 真正落到 `outputs/workspaces/{sessionId}/checkpoints/`。
3. **人工审批节点**并没有使用 `deepagents` 官方推荐的 `interrupt_on` / `interrupt()` / `Command(resume)` 这条标准链路，而是项目自己实现了 `HITLService + Electron IPC + React 审批组件`。这能工作，但属于**自定义 HITL 编排**，不是框架原生最佳实践。
4. **阶段转换**主要不是由显式状态机驱动，而是由 `SKILL.md` 中的流程约束、`Todo` 状态、工具调用顺序、以及“恢复会话时带入的提示语”共同驱动。换句话说，**业务阶段推进主要是项目自己实现的，而且相当依赖 prompt discipline**。这本身并不一定是错误，因为本项目本来就是建立在 `deepagents + skill` 的动态编排思想之上。
5. **重试策略**目前是局部、分散、工程化兜底式实现，不是统一控制层。仓库里有少量文件系统/收尾校验重试，但没有一个统一的、按阶段/按工具/按错误类型管理的 retry policy。
6. **补偿操作**基本上没有形成完整 Saga/补偿体系。当前更接近“取消后保留 checkpoint，用户再决定继续或局部重做”，而不是“系统自动回滚前序副作用”。
7. 因此，这套方案对当前这个 Electron 单机、多媒体生成、人工确认频繁的应用来说**可用且务实**，但如果按社区更严格的“状态工作流控制层最佳实践”衡量，它还属于**半框架化、半业务拼装**，离“显式图状态机 / durable workflow engine / BPMN 审批流”还有距离。
8. 不过，这里的改进方向**不应理解为“把 `deepagents + skill` 改造成纯显式状态机系统”**。更合理的方向是：**继续保留动态编排，把显式控制状态限制在审批、恢复、副作用一致性这些硬边界上**。

一句话概括：

> 当前实现更像“有 durable execution 底座的 Agent 应用”，而不是“业务状态机明确、补偿与重试完备的工作流引擎”；如果要演进，优先方向也应是“补最小控制状态”，而不是“全面状态机化”。

---

## 3. 当前项目里控制层的真实分布

### 3.1 关键模块分布

当前相关能力主要散落在这些文件：

- `backend/agent/AgentFactory.ts`
- `backend/application/agent/invoke-agent-use-case.ts`
- `backend/services/workspace-checkpoint-saver.ts`
- `backend/services/runtime-manager.ts`
- `backend/services/hitl-service.ts`
- `backend/config/hitl-config.ts`
- `electron/ipc/agent.ts`
- `electron/ipc/hitl.ts`
- `src/app/components/HitlConfirmBlock.tsx`
- `backend/config/skills/story-book/SKILL.md`
- `backend/config/skills/story-book/config.yaml`
- `backend/tools/*.ts`

### 3.2 一张表看清“谁负责什么”


| 控制层能力  | 底层框架负责                                                          | 项目自己负责                                                      | 当前判断               |
| ------ | --------------------------------------------------------------- | ----------------------------------------------------------- | ------------------ |
| 阶段转换   | `deepagents`/`LangChain` 只负责 agent/tool 调度能力，不负责你的业务阶段语义        | `SKILL.md`、Todo、工具调用顺序、前端恢复提示、业务工具                          | **主要是项目自己实现**      |
| 长任务持久化 | LangGraph 提供 checkpointer 协议、`thread_id`、durable execution 语义   | `WorkspaceCheckpointSaver` 的磁盘落盘、workspace 路径、session 绑定    | **框架底座 + 项目落地**    |
| 人工审批节点 | LangGraph / deepagents 原生支持 interrupt/HITL                      | 本项目没走官方 interrupt 链路，而是自己做 `HITLService + IPC + React UI`   | **主要是项目自己实现**      |
| 重试策略   | LangChain 有 `modelRetryMiddleware` / `toolRetryMiddleware` 能力可用 | 当前只在少数工具/文件系统里手写重试                                          | **主要是项目自己实现，但不完整** |
| 补偿操作   | 框架都不会替你自动定义业务补偿                                                 | 当前基本未形成统一补偿机制                                               | **基本缺失**           |
| 恢复执行   | LangGraph 支持同一 `thread_id` 恢复                                   | 项目自己把 `sessionId` 绑定为 `thread_id`，并在 reopen 时注入“只继续当前步骤”的约束 | **框架底座 + 项目策略**    |


---

## 4. 框架层到底实现了什么

## 4.1 `deepagents` 负责的部分

从项目的 `AgentFactory` 看，主 agent 由 `createDeepAgent()` 创建，说明项目把 `deepagents` 当作“生产型 agent runtime 组装器”来用。

`deepagents` 在这个项目里实际承担的职责主要有：

- 主 agent 运行时组装
- skills 加载机制
- subagents 接口与 general-purpose subagent 机制
- 与 LangGraph 持久化/流式执行的集成
- 一套偏 opinionated 的 agent runtime 默认结构

但要注意：

1. `deepagents` **没有直接替项目定义绘本业务阶段**。
2. 项目虽然用了 `skills`，但 **阶段 1 到阶段 6 的业务顺序其实写在 `backend/config/skills/story-book/SKILL.md` 里**，不是 `deepagents` 自带的 workflow DSL。
3. `deepagents` 官方的 HITL 推荐方式是 `interruptOn` 或直接走 LangGraph interrupt；但仓库里没有 `interruptOn`、`interrupt()`、`Command(...)` 的实际使用，说明项目**没有采用 deepagents 官方 HITL 主路径**。

所以对 `deepagents` 的准确判断应该是：

> 它提供的是“agent runtime 组织方式”和“能力装配层”，不是这个项目的业务控制层本体。

## 4.2 `LangChain` 负责的部分

`LangChain` 在这里主要承担：

- `createAgent()` 这类 agent runnable 构建能力
- tool abstraction（`tool(...)`）
- model/tool middleware 体系
- `@langchain/core` 的工具 schema、消息、runnable 基础抽象

项目里 `LangChain` 更多是**构件层**，不是业务编排层。

尤其是：

- 工具定义使用 `@langchain/core/tools`
- 子代理有一部分可以走 `createAgent()`
- `LangChain` 官方其实有 `modelRetryMiddleware` / `toolRetryMiddleware`

但当前仓库**没有把这些 middleware 真正接到主控制层上**。因此：

> `LangChain` 提供了 agent、tool、middleware 的底层构件，但仓库并没有把它用成“统一重试/统一编排控制平面”。

## 4.3 `LangGraph` 负责的部分

这是当前控制层里最重要的框架底座。

`LangGraph` 在官方语义上提供：

- durable execution
- checkpoint persistence 抽象
- `thread_id` 作为恢复游标
- `interrupt()` / `Command(resume)` 的人机中断恢复模型
- graph/node/task 的可恢复执行语义

项目里真正借到的核心能力是：

- `WorkspaceCheckpointSaver` 继承 `BaseCheckpointSaver`
- `sessionId` 被统一当作 `thread_id`
- agent 每次 reopen 时复用同一 `thread_id`
- 这样同一 session 可以从上次 checkpoint 恢复

这意味着：

> “长任务可恢复”这件事，根本上是 LangGraph 在负责；项目负责的是把它持久化到自己的 workspace，并把业务 session 映射成 LangGraph thread。

但是，项目**没有完全采用 LangGraph 的显式 graph / interrupt 控制方式**，而是只使用了它的 durability/checkpointer 侧。

---

## 5. 项目自己实现了什么

## 5.1 阶段转换：基本由项目自己实现

当前的业务阶段转换并不是一个显式状态机，而是下面几层一起作用：

1. `story-book` skill 的自然语言流程约束
2. `write_todos` 维护的步骤状态
3. 具体工具调用的顺序约束
4. reopen session 时追加的“仅继续当前步骤，不要从头重跑”的提示

这意味着业务上的“Step 1 -> Step 6”不是代码里的 enum 状态机，而是：

- prompt 中规定顺序
- todo 作为外显状态
- 工具结果作为事实检查
- checkpoint 作为恢复锚点

这种做法的优点：

- 开发快
- 对 agent 产品很自然
- skill-first 体验强
- 更符合 `deepagents + skill` 的动态编排哲学

缺点：

- 阶段语义不够硬
- 很多约束依赖模型遵守提示词
- 难做严格的 transition guard
- 难做系统级回滚和统一审计
- 当流程涉及审批、恢复、局部重做和大量产物复用时，容易出现“系统不知道当前真相、只能靠 agent 猜”的问题

结论：

> 阶段转换是当前项目最“业务自研”的一层，而且不是显式状态机实现；这对当前架构是合理起点，但后续应考虑只在硬边界处补最小控制状态，而不是直接推翻成纯状态机。

## 5.2 人工审批节点：项目自研 HITL 控制链

这条链路几乎是项目自己搭出来的：

- `AgentFactory.ts` 里定义 `requestApprovalViaHITL()`
- tool 在真正执行前显式调用该方法
- `HITLService` 生成 request，发到 Electron renderer
- `electron/ipc/hitl.ts` 接收前端响应
- `src/app/components/HitlConfirmBlock.tsx` 负责展示、编辑、批准、取消

它支持的能力比 deepagents 默认 tool-approval 更业务化：

- 可编辑 payload
- 不同动作类型不同 UI
- Markdown 审稿场景 `story.plan_review`
- 图片标注位置编辑
- allowlist / auto / strict 三种审批模式

这部分是当前项目非常鲜明的自研资产。

但也意味着：

- 它和 LangGraph 原生 interrupt 模型是“两套概念”
- 恢复逻辑靠“工具抛错 + 下次同 thread 重进”
- 不是官方推荐的 `interrupt -> Command(resume)` 标准恢复路径

所以：

> 这是一个可工作的业务 HITL 外挂层，不是 deepagents/LangGraph 的原生 HITL 用法。

## 5.3 持久化与恢复：项目做了很关键的一层适配

`WorkspaceCheckpointSaver` 是这份调研里最关键的自研模块之一。

它做了几件 LangGraph 不会替你做的事：

- 把 checkpoint 保存到项目的 workspace 目录
- 处理 Windows 文件名兼容问题
- 把 `thread_id` 稳定映射到 `sessionId`
- 处理 `putWrites()` 在部分情况下拿不到 `thread_id` 的回退问题
- 支持列举、读取、删除线程 checkpoint

因此，“LangGraph 可持久化”与“这个项目真的能在 session workspace 里恢复”之间，桥梁就是它。

这是明显的工程加分项。

## 5.4 重试：目前是局部补丁式，不是统一控制层

当前仓库能看到的重试，主要是：

- `finalize_workflow.ts` 对图片/音频存在性做短暂重试
- `fs.ts` 对 `rm()` 的 `EPERM/EBUSY` 做少量重试

此外，各 AI provider 适配层里可能还有自己的 polling / request 逻辑，但那属于**基础设施调用层**，不是统一 workflow control policy。

缺失的部分是：

- 没有统一声明式 retry policy
- 没有按错误类型区分是否重试
- 没有幂等键治理
- 没有“阶段失败后自动从哪一层恢复”的统一规则
- 没有把 LangChain 官方 retry middleware 接到主运行链路

所以：

> 当前重试更像“工程兜底”，不是“控制层设计”。

## 5.5 补偿操作：基本缺失

严格来说，补偿操作应该回答：

- 第 4 步失败时，要不要回滚第 3 步已经写出的文件？
- 用户拒绝审批后，是否自动撤销前面临时产物？
- 重新执行时如何避免重复写文件、重复调用外部 API、重复扣费？

当前项目更接近以下策略：

- 用户取消 -> 当前 run 终止
- checkpoint 保留
- 用户下一次发消息再继续
- 如需局部重做，依赖方案更新 + 人工重新确认 + 局部重跑

这不是补偿模式，而是**人工驱动的修正/重做模式**。

仓库里有 `delete_artifacts` 工具，但它更像人工触发清理，不是自动 Saga compensation。

结论：

> 当前项目没有完整补偿层，只有人工驱动的“取消/重做/删除产物”替代方案。

---

## 6. 逐项判断：哪些是框架实现，哪些是项目实现

## 6.1 阶段转换

### 框架实现部分

- `deepagents` / `LangChain` 让 agent 能调用工具、维护消息上下文、执行 subagent
- `LangGraph` 能保存状态并在下次继续

### 项目实现部分

- 6 步绘本业务阶段定义
- 阶段顺序规则
- Todo 与阶段同步
- reopen session 后的“局部继续”约束
- `finalize_workflow` 完成判定

### 判断

**主要是项目自己实现。**

## 6.2 重试策略

### 框架实现部分

- `LangChain` 提供 retry middleware 能力，但当前未实际用作主流程控制

### 项目实现部分

- `finalize_workflow` 文件存在性短重试
- `WorkspaceFilesystem.rm()` 重试

### 判断

**当前主要是项目自己零散实现，且实现不完整。**

## 6.3 补偿操作

### 框架实现部分

- 无框架会自动替业务定义补偿

### 项目实现部分

- 基本没有统一补偿层
- 主要依赖人工取消、局部重做、删除产物

### 判断

**当前基本没有成体系实现。**

## 6.4 人工审批节点

### 框架实现部分

- LangGraph/deepagents 原生支持 interrupt / interruptOn / resume

### 项目实现部分

- `HITLService`
- `hitl-config.ts`
- Electron IPC 请求/响应桥
- React 审批界面与可编辑 payload

### 判断

**当前运行链路主要是项目自己实现；框架原生 HITL 能力没有被直接采用。**

## 6.5 长任务状态持久化与恢复

### 框架实现部分

- LangGraph checkpointer 协议
- durable execution 语义
- `thread_id` 恢复机制

### 项目实现部分

- `WorkspaceCheckpointSaver`
- sessionId 映射 thread_id
- workspace 文件布局
- reopen session 的业务恢复提示

### 判断

**这是最典型的“框架底座 + 项目自定义落地”。**

---

## 7. 这套实现算最佳实践吗

## 7.1 可以肯定的优点

### 1. 选对了 durability 底座

对 AI agent 产品来说，最容易做错的是只做消息历史，不做真正可恢复执行。这个项目已经接上了 LangGraph checkpointer，这是对的。

### 2. `sessionId -> thread_id` 的映射非常合理

这让“会话恢复”和“工作流恢复”统一成一个主键，工程上很自然。

### 3. 把 checkpoint 存到 workspace 目录是很好的产品化落地

比单纯用内存 `MemorySaver` 强很多，也比把所有状态散落到多个未知位置更可维护。

### 4. HITL UI 做得比通用框架默认能力更贴业务

比如：

- Markdown 审稿
- 图片标注编辑
- 文本编辑后继续执行

这些都说明项目不是停留在“能审批”层面，而是做了业务化审批体验。

## 7.2 不足与偏离最佳实践的地方

### 1. 业务阶段没有显式状态机

目前阶段推进主要靠 prompt、todo、工具和恢复提示共同维护。  
这对模型友好，也符合 `deepagents + skill` 的设计初衷，但对控制层不够硬。

社区里更稳的做法通常是补一层显式控制信息，例如：

- 显式控制真相字段
- 显式 transition guard
- 显式“当前阶段允许哪些动作”
- 显式记录审批/产物/恢复边界

但这里要强调：

> 对本项目而言，更合理的方向不是“把整套 `deepagents + skill` 改造成纯显式状态机”，而是“继续保留动态编排，只对审批、恢复、副作用一致性补最小必要控制状态”。

### 2. HITL 没走 LangGraph 原生 interrupt 链路

当前实现当然能工作，但它的语义是：

- 工具先请求人工确认
- 若拒绝则抛错结束 run
- 下次重新进入同一阶段

这和 LangGraph 官方推荐的：

- `interrupt()`
- 外部返回 `Command(resume)`
- 在同一图语义内继续执行

不是一回事。

前者更自由，但后者更标准、更一致，也更容易和 durable execution 的语义保持完全统一。

### 3. 缺少统一 retry / idempotency / compensation 设计

这是目前离“生产级工作流控制层最佳实践”差距最大的地方。

没有这些能力时，系统会更依赖：

- 人工判断
- 人工局部重做
- 文件是否存在的弱校验

这对单机产品可接受，但对更复杂流程不够稳。

### 4. 存在两套“持久化概念”

仓库中既有：

- 真正用于 LangGraph durable execution 的 `WorkspaceCheckpointSaver`
- 也有一个看起来更早期、文件型的 `PersistenceService` / `FileBasedCheckpointer`

从当前主链路看，真正接到 `createDeepAgent()` 的是前者；后者更多像 runtime 配套或遗留设计。  
这会增加理解成本，也说明控制层架构还未完全收敛。

## 7.3 总体评价

如果以“一个 Electron 智能体应用”的标准看：

> 这是**合理、务实、已经能上线迭代**的实现。

如果以“社区公认的显式状态工作流控制层最佳实践”看：

> 它还不是最佳实践，只能算**不错的第一代工程实现**。

更准确地说，它是：

- **Durable execution：做对了**
- **业务阶段控制：半显式**
- **HITL：业务体验强，但不是框架原生**
- **Retry/Compensation：明显不足**

---

## 8. 社区还有哪些经典实现方式

下面按社区最常见的几类路线来比较。

## 8.1 路线 A：LangGraph 原生显式图工作流

### 典型做法

- 用 `StateGraph` 明确定义状态类型
- 每个阶段一个 node
- 审批点直接 `interrupt()`
- 人工确认后 `Command(resume)`
- 用 SQLite/Postgres/自定义 saver 做 durable persistence

### 适合场景

- AI agent 驱动的多阶段流程
- 需要显式阶段控制，但仍希望保留 LLM 灵活性
- 需要 pause / resume / human-in-the-loop

### 相比本项目

优点：

- 阶段更清晰
- 语义更统一
- 与 LangGraph durable execution 完全一致
- 更容易做阶段 guard、分支、回溯、审计

缺点：

- 代码量更大
- 需要把目前 prompt 内的阶段规则转成显式 graph

### 对本项目的意义

这是**最自然的下一步演进方向**。  
如果未来仍以 `deepagents + LangGraph` 为主栈，这条路线最匹配。

## 8.2 路线 B：Temporal Durable Workflow

### 典型做法

- 用 Workflow 描述长事务
- 用 Activity 包装外部副作用
- 用 Retry Policy 统一配置重试
- 用 Signal / Update 等待人工确认
- 用 Saga / cleanup activity 做补偿
- 长流程通过 `continueAsNew` 保持历史可控

### 适合场景

- 任务持续时间长
- 外部副作用多
- 要求强恢复、强可观测、强补偿
- 需要多服务协作或强生产可靠性

### 相比本项目

优点：

- 重试、补偿、暂停、恢复都是一等公民
- 非常适合“绝不能丢状态”的流程
- 社区对长事务、审批、saga 模式积累深

缺点：

- 系统复杂度显著上升
- 对单机 Electron 应用可能偏重
- LLM agent 本身的图式控制不如 LangGraph 贴近

### 对本项目的意义

如果未来这个产品从“桌面生成工具”走向“多用户、服务端、多任务并发平台”，Temporal 会比当前架构更像终局方案。

## 8.3 路线 C：BPMN / Camunda / Zeebe

### 典型做法

- 用 BPMN 明确定义流程图
- User Task 表示人工审批
- Boundary Event 处理异常
- Timer 处理超时
- Compensation Event 处理回滚

### 适合场景

- 强审批流
- 多角色协作
- 合规要求高
- 流程需要业务人员可视化理解

### 相比本项目

优点：

- 阶段和审批建模最清楚
- 适合企业流程、审核流、运营流
- 很强的审计与可视化

缺点：

- 对 AI agent 细粒度推理链不够自然
- 开发体验偏流程平台，不是 agent-first

### 对本项目的意义

如果未来“绘本生成”变成一个多人审核、多轮审批、多角色协作的出版流程，BPMN 会很有吸引力；但对当前产品形态，它大概率过重。

## 8.4 路线 D：AWS Step Functions / 云状态机

### 典型做法

- 状态机定义步骤
- `Retry` / `Catch` 管失败路径
- callback token 做人工确认
- `Wait` / `Choice` 管超时和分支

### 适合场景

- 云上 serverless 编排
- 明确 DAG / state machine
- 与云服务强集成

### 相比本项目

优点：

- 托管化
- retry / catch / callback 语义很成熟

缺点：

- 更偏云编排
- 对桌面本地工作区和 agent 技能系统不自然

### 对本项目的意义

如果未来迁到云端服务化，这是一条可选路；当前单机 Electron 形态下不如 LangGraph/Temporal 合适。

## 8.5 路线 E：继续保留 Agent，但在项目内补一个轻量控制状态层

### 典型做法

- 继续用 `deepagents` 负责 agent/tool 动态编排
- `SKILL.md` 继续负责“如何思考、如何决策、如何组织工具调用”
- 在系统侧只补少量显式控制状态，专门用于审批、恢复、副作用一致性
- 恢复时优先参考控制状态和产物事实，而不是只靠 prompt 推断
- HITL、重试、产物复用等硬边界由系统状态约束，创作与执行细节仍交给 agent

### 适合场景

- 不想更换大框架
- 但想把控制层硬起来
- 希望保留 `skill-first` 与动态编排优势

### 对本项目的意义

这是**成本最低、收益很高**的现实路线，也比“全面显式状态机化”更符合本项目当前架构。

---

## 9. 对当前项目最合理的判断

## 9.1 它不是“deepagents 自动帮你实现了工作流控制层”

很多人会误以为：

- 用了 `deepagents`
- 用了 `LangChain`
- 用了 `LangGraph`

所以“Stateful Workflow / 控制层”就自动有了。

这在本项目里并不成立。

真实情况是：

- `deepagents` 给了 agent runtime 组织方式
- `LangChain` 给了 tool / agent / middleware 构件
- `LangGraph` 给了 durable execution 与 checkpoint 底座
- **真正把绘本业务流程串起来的是项目自己的 Skill、Tool、HITL、workspace persistence、session 恢复策略**

所以：

> 当前控制层的“业务大脑”主要在项目里，不在框架里。

## 9.2 它也不是“完全自研工作流引擎”

反过来说，这个项目也不是从零自己造了一套 durable workflow engine。

因为最难的那部分：

- checkpoint 语义
- thread 恢复
- durable execution
- replay 基础模型

本质上都还是站在 LangGraph 之上。

所以更准确的定位是：

> 这是一个**以 LangGraph 为恢复底座、以 deepagents 为 agent runtime、以项目业务逻辑为控制层外壳**的混合架构。

---

## 10. 对“是否最佳实践”的最终结论

我的最终判断是：

### 结论 A：当前实现不是最标准的社区最佳实践

原因：

- 阶段转换不够显式
- HITL 没有走框架原生语义
- retry/compensation 不成体系
- 控制层分散在 prompt、tool、service、UI 多处

### 结论 B：但它对当前产品阶段是合理的工程折中

原因：

- 桌面本地应用
- 业务链路相对线性
- 人工确认很多
- 产物主要是文件
- 团队更需要“能跑、能恢复、能审批”，未必立刻需要企业级 Saga

### 结论 C：如果项目继续演进，最值得优先补的不是“换框架”，也不是“全面状态机化”，而是“补最小必要控制状态”

建议优先级如下：

1. 先识别真正需要系统掌握的“控制真相”
2. 统一 retry policy
3. 为外部副作用引入幂等键和 artifact manifest
4. 把 HITL 语义逐步向 LangGraph 原生 interrupt 靠拢，或明确坚持自定义路线并补齐控制状态约束
5. 只有在系统继续服务化、多人化、强补偿化后，再考虑引入 Temporal/Camunda 级别平台

---

## 11. 对本项目的具体建议

## 11.1 短期建议（最值得做）

### 建议 1：补“最小必要控制状态”，而不是完整显式状态机

不建议直接把整个项目改造成“全流程显式状态机 + 完整 `WorkflowState` 主导”的系统。  
更合理的做法是先补少量、真正有业务价值的控制状态，只解决下面这些系统性问题：

- 审批挂起时，系统是否明确知道当前等待什么
- 会话恢复时，系统是否明确知道哪个事实已经确认
- 局部重做时，系统是否明确知道哪些产物可复用、哪些需要重建

优先级更高的候选字段是：

- `approvedPlanVersion`
- `pendingHumanAction`
- `artifactManifest`

这些字段有明确业务含义，能直接改善审批、恢复和副作用一致性。  
下面这些字段则不必一开始就上：

- `phase`
- `phaseStatus`
- `redoScope`
- `retryCountByStep`
- `lastCompletedStep`

是否需要它们，应取决于后续是否真的出现“恢复错步、重复生成、局部重做不准”这类问题。

### 建议 1.1：这些内容应该放在哪里

这一点必须分层，不能混放：

- `SKILL.md`
  - 放 agent 的行为原则、工作流意图、何时调用什么工具
  - 不放运行时控制真相
- `config.yaml`
  - 放静态工作流规则，例如阶段定义、允许工具、审批开关、局部重做是否允许
  - 不放某个会话当前走到哪一步
- `outputs/workspaces/{sessionId}/meta/*.json`
  - 放每个 session 的运行时控制状态，例如 `approvedPlanVersion`、`pendingHumanAction`、`artifactManifest`
  - 这是最适合保存会话级真相的位置
- `checkpoints/`
  - 继续只承担 LangGraph durable execution 快照，不替代业务控制状态

可以用一句话概括：

> `SKILL.md` 放“智能体行为原则”，`config.yaml` 放“静态工作流规则”，session `meta` 放“运行时控制状态”。

### 建议 2：统一 retry policy

至少分三层：

- provider 调用重试
- 工具级重试
- workflow 级重试/失败转人工

并区分：

- 可重试错误
- 不可重试错误
- 需要人工介入错误

### 建议 3：补幂等与副作用保护

例如：

- 同一页图片生成使用固定 artifact key
- 同一页音频生成使用固定 logical target
- 恢复执行前先查 manifest，而不是只看文件是否存在

### 建议 4：收敛持久化概念

明确：

- 谁是主 checkpointer
- `PersistenceService` 是否仍然需要
- 哪些状态由 checkpoint 管，哪些状态由 workspace meta 管

## 11.2 中期建议（推荐）

### 方案一：继续留在当前栈，逐步补轻量控制状态

这是最推荐的中期方向。

原因：

- 和现有技术栈最兼容
- 不需要推翻 deepagents
- 能先解决审批、恢复、副作用一致性问题
- 不会过早牺牲 `skill-first` 和动态编排能力

### 方案二：迁移到 LangGraph 显式状态图

如果后续发现“最小控制状态”仍然不足，再考虑把关键阶段进一步提升为显式 graph 节点。

### 方案三：保留现有 agent，但外面包一层更完整的业务状态机

如果未来恢复、重做、审批、补偿都越来越复杂，这条路线会比当前更稳，但也更重。

## 11.3 长期建议（系统升级后再考虑）

若未来出现以下特征：

- 多用户并发任务
- 服务端任务队列
- 强 SLA
- 必须自动补偿
- 必须跨服务协调

可以考虑 Temporal。  
如果未来重点转向多人审批、运营流程、出版流程，则考虑 Camunda/BPMN。

---

## 12. 最终回答

针对你的原问题，最简洁的回答是：

### 哪部分是 `deepagents` / `LangChain` / `LangGraph` 实现的？

- `deepagents`：agent runtime 组装、skills、subagents、与 LangGraph 的集成外壳
- `LangChain`：tools、agent runnable、middleware 基础能力
- `LangGraph`：checkpoint、`thread_id`、durable execution、恢复执行语义

### 哪部分是项目自己实现的？

- 绘本业务的 6 阶段推进逻辑
- Todo 驱动的阶段可见状态
- 自定义 HITL 服务、IPC、前端审批 UI
- `WorkspaceCheckpointSaver` 的磁盘落地
- reopen session 的继续执行策略
- 局部重做和方案确认流程

### 这些实现是最佳实践吗？

- **长任务恢复底座**：比较接近最佳实践
- **业务控制层整体**：还不是最佳实践
- **HITL 业务体验**：做得不错
- **显式状态机 / retry / compensation**：明显还有提升空间

---

## 13. 参考资料

### 本项目源码

- `backend/agent/AgentFactory.ts`
- `backend/application/agent/invoke-agent-use-case.ts`
- `backend/services/workspace-checkpoint-saver.ts`
- `backend/services/hitl-service.ts`
- `backend/config/hitl-config.ts`
- `backend/config/skills/story-book/SKILL.md`
- `backend/config/skills/story-book/config.yaml`
- `src/app/components/HitlConfirmBlock.tsx`

### 官方文档与社区资料

- LangGraph durable execution: [https://docs.langchain.com/oss/javascript/langgraph/durable-execution](https://docs.langchain.com/oss/javascript/langgraph/durable-execution)
- LangGraph / human-in-the-loop concepts: [https://langchain-ai.github.io/langgraphjs/concepts/human_in_the_loop](https://langchain-ai.github.io/langgraphjs/concepts/human_in_the_loop)
- Deep Agents `createDeepAgent`: [https://reference.langchain.com/javascript/deepagents/index/createDeepAgent](https://reference.langchain.com/javascript/deepagents/index/createDeepAgent)
- Deep Agents skills: [https://docs.langchain.com/oss/javascript/deepagents/skills](https://docs.langchain.com/oss/javascript/deepagents/skills)
- Deep Agents subagents: [https://docs.langchain.com/oss/javascript/deepagents/subagents](https://docs.langchain.com/oss/javascript/deepagents/subagents)
- Deep Agents human-in-the-loop: [https://docs.langchain.com/oss/javascript/deepagents/human-in-the-loop](https://docs.langchain.com/oss/javascript/deepagents/human-in-the-loop)
- LangChain middleware / retry: [https://docs.langchain.com/oss/javascript/langchain/middleware/built-in](https://docs.langchain.com/oss/javascript/langchain/middleware/built-in)
- Temporal TypeScript docs: [https://docs.temporal.io/](https://docs.temporal.io/)
- Camunda 8 docs: [https://docs.camunda.io/](https://docs.camunda.io/)
- AWS Step Functions docs: [https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html)

