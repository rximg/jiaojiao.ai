# 项目 DDD 架构约束

> 本文档描述 `jiaojiao` 项目后端的 DDD 落地规则，是对《DDD核心概念及桌面端后端迁移指南》的**项目级具体化**。所有新增后端代码必须遵守以下约束。

---

## 一、分层边界与依赖方向

本项目后端严格遵循**单向依赖原则**：

```
domain ← application ← infrastructure ← services ← electron/ipc
```


| 层次                 | 路径                        | 允许依赖                                       | 禁止依赖                                                 |
| ------------------ | ------------------------- | ------------------------------------------ | ---------------------------------------------------- |
| **Domain**         | `backend/domain/`         | 无（纯 TypeScript 类型/接口）                      | 所有其他层，禁止 import infrastructure / services / electron |
| **Application**    | `backend/application/`    | `domain/` 类型                               | `infrastructure/`（依赖通过函数参数注入，不直接 import 实现类）         |
| **Infrastructure** | `backend/infrastructure/` | `domain/`、第三方 SDK                          | 不直接 import `application/`                            |
| **Services**       | `backend/services/`       | `domain/`、`infrastructure/`、`application/` | 不 import `electron/`                                 |
| **Electron IPC**   | `electron/ipc/`           | `services/`、`application/`（通过 services 委托） | 不 import `domain/` 实现细节                              |


**违规示例（禁止）：**

```typescript
// ❌ domain 层 import 了 infrastructure
// backend/domain/session/entities/session.ts
import { SessionFsRepository } from '../../infrastructure/...';

// ❌ application 层直接 import infrastructure 实现
// backend/application/agent/invoke-agent-use-case.ts
import { MultimodalPortImpl } from '../../infrastructure/inference/multimodal-port-impl.js';
```

---

## 二、领域层约束（`backend/domain/`）

### 2.1 当前领域划分

本项目识别出以下**限界上下文（Bounded Context）**：


| 上下文        | 路径                      | 核心职责                          |
| ---------- | ----------------------- | ----------------------------- |
| **会话上下文**  | `domain/session/`       | 管理对话生命周期，Session 为聚合根         |
| **推理上下文**  | `domain/inference/`     | AI 多模态能力的端口抽象（LLM/T2I/TTS/VL） |
| **工作区上下文** | `domain/workspace/`     | 产物文件的增删查，路径隔离                 |
| **配置上下文**  | `domain/configuration/` | 用户 AI 偏好、API Key、模型选择         |


### 2.2 实体（Entity）

目前项目仅有**一个实体**作为聚合根：

```typescript
// backend/domain/session/entities/session.ts
export interface Session {
  sessionId: string;   // 唯一标识（UUID）
  meta: SessionMeta;   // 值对象
}
```

约束：

- `sessionId` 是全局唯一标识符（`randomUUID()` 生成），**不可修改**
- 修改 Session 状态必须通过仓储 `save()` 持久化，不允许直接对内存引用写入后跳过 `save`
- 新增实体时必须携带不可变的 ID 字段，不以 `name`、`path` 等属性作为标识

### 2.3 值对象（Value Object）

```typescript
// backend/domain/session/value-objects/session-meta.ts
export interface SessionMeta {
  title?: string;
  createdAt?: string;        // ISO 8601，创建后不可改
  updatedAt?: string;        // 每次修改更新
  caseId?: string;           // 场景标识，不可变
  // ...
}
```

约束：

- 值对象字段全部为只读语义，修改须新建对象（`{ ...oldMeta, title: newTitle }`）
- 领域层中：`PromptInput`（提示词输入）、`SynthesizeSpeechItem`（TTS 条目）均为值对象，禁止加 `id` 字段使其变为实体
- 值对象不包含业务行为方法，仅描述数据结构

### 2.4 仓储接口（Repository）

领域层定义接口，**实现类只能放在 `infrastructure/`**：


| 接口                   | 领域路径                                                     | 实现路径                                                                           |
| -------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `SessionRepository`  | `domain/session/repositories/session-repository.ts`      | `infrastructure/persistence/session/session-fs-repository.ts`                  |
| `ArtifactRepository` | `domain/workspace/repositories/artifact-repository.ts`   | `infrastructure/persistence/workspace/artifact-fs-repository.ts`               |
| `ConfigRepository`   | `domain/configuration/repositories/config-repository.ts` | `infrastructure/persistence/configuration/config-electron-store-repository.ts` |


约束：

- **仓储只操作聚合根**：`SessionRepository` 操作 `Session`，不单独查询 `SessionMeta`
- 禁止在仓储接口中引入 `electron-store`、`fs`、`sharp` 等技术类型
- 所有仓储通过 `backend/infrastructure/repositories.ts` 中的**单例工厂**获取，不直接 `new`

### 2.5 推理端口（Inference Ports）

项目采用**端口与适配器（Hexagonal）**模式封装 AI 能力：

```typescript
// 同步端口：一次 execute 返回结果（VL / TTS / ImageEdit 等）
interface SyncInferencePort<TInput, TOutput> {
  execute(input: TInput): Promise<TOutput>;
}

// 异步端口：submit 得 taskId，再 poll 得结果（T2I 文生图等）
interface AsyncInferencePort<TInput, TTaskId, TOutput> {
  submit(input: TInput): Promise<TTaskId>;
  poll(taskId: TTaskId): Promise<TOutput>;
}

// 业务组合端口（Tools 层依赖此端口）
interface MultimodalPort {
  generateImage(params: GenerateImageParams): Promise<GenerateImageResult>;
  editImage(params: EditImageParams): Promise<EditImageResult>;
  synthesizeSpeech(params: SynthesizeSpeechParams): Promise<SynthesizeSpeechResult>;
  generateScriptFromImage(params: GenerateScriptFromImageParams): Promise<GenerateScriptFromImageResult>;
}
```

约束：

- Tools（智能体工具）**只能依赖 `MultimodalPort`**，禁止直接调用 DashScope / Zhipu SDK
- 新增 AI 能力时，必须先在 `domain/inference/` 增加对应的接口和类型，再在 `infrastructure/inference/` 实现
- 端口接口参数中的数据类型必须是领域值对象（在 `domain/inference/types.ts` 中定义），不暴露 SDK 的原始类型

---

## 三、应用层约束（`backend/application/`）

### 3.1 用例形式

本项目应用层用例采用**纯函数 + 显式依赖注入**，而非类/装饰器：

```typescript
// ✅ 正确：纯函数，依赖通过参数传入
export async function createSessionUseCase(
  deps: CreateSessionUseCaseDeps,   // 依赖接口
  params: CreateSessionUseCaseParams
): Promise<CreateSessionUseCaseResult> { ... }

// ❌ 禁止：类形式 + 构造函数注入（不符合本项目约定）
export class CreateSessionUseCase {
  constructor(private sessionRepo: SessionRepository) {}
}
```

约束：

- 每个用例文件导出：`UseCaseDeps`（依赖接口）、`UseCaseParams`（输入参数）、`UseCaseResult`（返回类型）、用例函数本身
- **用例不包含业务规则判断**，只做流程编排（调用顺序、错误包装）
- 用例函数不直接 import infrastructure 实现类，所有具体实现通过 `deps` 参数注入
- 用例函数必须是 `async function`，错误向上抛出，不在内部吞掉

### 3.2 RunContext（跨异步边界上下文）

```typescript
// backend/application/agent/run-context.ts
export interface RunContext {
  threadId: string;
  onBatchProgress?: (...) => void;
  messageId?: string;
  toolCallId?: string;
}
```

约束：

- `RunContext` 通过 `AsyncLocalStorage` + 模块级变量双保险传递（LangGraph 工具执行时 ALS 可能丢失）
- 工具函数中用 `getRunContext()` 获取当前上下文，**禁止**将 `RunContext` 作为工具参数直接传递
- `setCurrentRunContext(null)` 必须在流式 run 结束（正常/异常）时调用，避免泄露

---

## 四、基础设施层约束（`backend/infrastructure/`）

### 4.1 仓储实现

- 实现类文件名格式：`{entity}-{storage-type}-repository.ts`，如 `session-fs-repository.ts`
- 实现类必须 `implements` 对应的领域接口，**类型系统强制约束**，禁止鸭子类型匹配
- 文件系统路径必须通过 `WorkspaceFilesystem` 解析，禁止在仓储内拼接 `outputs/workspaces/` + `sessionId`

### 4.2 推理适配器

- 按**能力**分子目录：`infrastructure/inference/adapters/{llm,vl,t2i,tts,image-edit}/`，各目录内以 `dashscope.ts` / `zhipu.ts`（及 `index.ts` 等）区分厂商；跨厂商可复用逻辑放在 `adapters/openai-compatible/` 或 `inference/` 根下小模块（如 `http-fetch-helpers.ts`）
- 适配器实现 `SyncInferencePort` 或 `AsyncInferencePort`（薄基类见 `bases/sync-inference-base.ts`、`async-inference-base.ts`），通过 `create-ports.ts` 工厂函数组装
- `MultimodalPortImpl` 是组合适配器，将四类能力端口聚合为 `MultimodalPort`，是 Tools 层的唯一依赖入口
- `getAIConfig()` 负责从 `AppConfig` 解析运行时 AI 提供商选择，**不允许在适配器内硬编码提供商**

### 4.3 依赖注入根（`repositories.ts`）

```typescript
// backend/infrastructure/repositories.ts
// 单例工厂，所有仓储和端口实例从此获取
export function getSessionRepository(): SessionRepository { ... }
export function getArtifactRepository(): ArtifactRepository { ... }
export function getConfigRepository(): ConfigRepository { ... }
export function getMultimodalPort(): MultimodalPort { ... }
```

约束：

- 所有单例工厂函数在此文件中注册，**禁止**在 services 或 IPC handler 内直接 `new` 仓储/端口实现类
- 单例通过模块级变量懒初始化（`let _repo: T | null = null`），不使用 IoC 容器

---

## 五、禁止事项速查


| #   | 禁止行为                                                         | 原因                                  |
| --- | ------------------------------------------------------------ | ----------------------------------- |
| 1   | `domain/` 中 import `infrastructure/`、`electron/`、`services/` | 破坏单向依赖，domain 必须零依赖                 |
| 2   | 用例函数内 `new SessionFsRepository()`                            | 绕过依赖注入，使单元测试无法 mock                 |
| 3   | 仓储接口方法参数使用 SDK 类型（如 `DashScopeConfig`）                       | 领域层不得感知技术细节                         |
| 4   | 在值对象上添加 `id` 或可变状态                                           | 值对象必须无标识、不可变                        |
| 5   | Tools 直接调用 `DashScopeT2IAdapter.execute()`                   | 必须经过 `MultimodalPort` 接口            |
| 6   | 在 `application/` 中直接 `ipcMain.emit()`/`ipcRenderer`          | 应用层不得感知 Electron IPC                |
| 7   | 同一限界上下文内跨越聚合根直接操作聚合内非根对象                                     | 破坏聚合一致性边界                           |
| 8   | 用例抛出 `electron-store` 原生错误                                   | 基础设施异常须在 infrastructure 层包装为领域/应用错误 |


---

## 六、新增功能的 DDD 操作检查清单

在开发新功能前，依次确认：

- 确定该功能属于哪个**限界上下文**（session / inference / workspace / configuration）
- 新数据结构是**实体**（有唯一标识、状态可变）还是**值对象**（无标识、不可变）？
- 需要持久化→先在 `domain/` 定义仓储接口，再在 `infrastructure/persistence/` 实现
- 需要调用 AI→先在 `domain/inference/types.ts` 定义参数/结果类型，再通过 `MultimodalPort` 调用
- 业务流程编排→写成纯函数用例（`application/`），依赖通过 `deps` 参数注入
- 暴露给前端→在 `electron/ipc/` 注册 IPC Handler，在 `preload.cjs` 暴露，在 `src/types/` 声明类型
- 运行 `tsc --noEmit` 确认无类型错误（domain 接口变更会连锁报错，须全部修复）

