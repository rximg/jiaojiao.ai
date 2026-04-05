# 前端架构文档

## 概述

前端运行于 Electron **渲染进程**（Renderer Process），是一个标准的 React 18 + TypeScript 单页应用（SPA）。它通过 `electron/preload.cjs` 暴露的 `window.electronAPI` 与主进程通信，**不直接访问任何 Node.js API**。

---

## 技术栈


| 层次          | 技术                          | 版本     |
| ----------- | --------------------------- | ------ |
| UI 框架       | React                       | 18.3.1 |
| 语言          | TypeScript                  | 5.5.4  |
| 构建工具        | Vite + vite-plugin-electron | 5.4.2  |
| 样式          | Tailwind CSS                | 3.4.7  |
| 组件库         | Radix UI + ShadCN           | —      |
| 状态管理        | React Context（内置）           | —      |
| Markdown 渲染 | react-markdown              | 9.0.1  |
| 布局          | react-resizable-panels      | 3.0.6  |


---

## 目录结构

```
src/
├── main.tsx              # 渲染进程入口，挂载 React App
├── App.tsx               # 根组件，路由 / 全局布局
├── index.css             # 全局样式（Tailwind base）
├── vite-env.d.ts         # Vite 环境类型声明
│
├── app/
│   └── components/       # 业务组件（见下表）
│
├── components/
│   └── ui/               # ShadCN 通用 UI 组件（Button、Dialog、Select…）
│
├── providers/
│   ├── ChatProvider.tsx   # 聊天状态 Context（消息列表、流式输出、会话）
│   └── ConfigProvider.tsx # 配置状态 Context（AI 设置、用户偏好）
│
├── types/                # TypeScript 类型定义
│   └── electron.d.ts     # window.electronAPI 接口声明
│
├── lib/                  # 工具函数（cn、格式化等）
├── assets/               # 静态资源
└── data/                 # 前端静态数据
```

---

## 核心业务组件


| 组件                      | 文件                                         | 职责                       |
| ----------------------- | ------------------------------------------ | ------------------------ |
| `ChatInterface`         | `app/components/ChatInterface.tsx`         | 主聊天界面，协调消息输入/输出流         |
| `ArtifactViewer`        | `app/components/ArtifactViewer.tsx`        | 展示生成产物（图片、音频、文档）         |
| `HistoryPanel`          | `app/components/HistoryPanel.tsx`          | 历史会话列表与切换                |
| `TodoPanel`             | `app/components/TodoPanel.tsx`             | 显示智能体当前任务进度（Todo list）   |
| `WorkspacePanel`        | `app/components/WorkspacePanel.tsx`        | 当前会话工作区文件浏览              |
| `ConfigDialog`          | `app/components/ConfigDialog.tsx`          | AI 服务商配置面板（API Key、模型选择） |
| `WelcomePage`           | `app/components/WelcomePage.tsx`           | 首次运行引导页                  |
| `CaseList`              | `app/components/CaseList.tsx`              | 预设场景快速入口列表               |
| `QuickOptions`          | `app/components/QuickOptions.tsx`          | 快捷操作按钮组                  |
| `HitlConfirmBlock`      | `app/components/HitlConfirmBlock.tsx`      | Human-in-the-loop 审批确认块  |
| `StepResultBlocks`      | `app/components/StepResultBlocks.tsx`      | 智能体步骤结果展示容器              |
| `ImageBlock`            | `app/components/ImageBlock.tsx`            | 单张图片展示（含注释框）             |
| `AudioBlock`            | `app/components/AudioBlock.tsx`            | 音频播放器块                   |
| `DocumentBlock`         | `app/components/DocumentBlock.tsx`         | 文档/脚本只读展示块               |
| `EditableDocumentBlock` | `app/components/EditableDocumentBlock.tsx` | 可编辑文档块                   |
| `ChatMessage`           | `app/components/ChatMessage.tsx`           | 单条消息渲染（Markdown + 工具结果）  |
| `SubTaskCard`           | `app/components/SubTaskCard.tsx`           | 子任务状态卡片                  |
| `ImagePrintDialog`      | `app/components/ImagePrintDialog.tsx`      | 绘本打印排版对话框                |
| `AgentErrorDialog`      | `app/components/AgentErrorDialog.tsx`      | 智能体错误提示对话框               |
| `QuotaErrorDialog`      | `app/components/QuotaErrorDialog.tsx`      | API 配额超限提示               |
| `BatchWrapper`          | `app/components/BatchWrapper.tsx`          | 批量操作包装容器                 |


---

## 状态管理

前端使用 **React Context** 而非第三方状态库，分为两个独立 Provider：

### `ChatProvider`

- 管理当前会话 ID、消息列表、流式 AI 输出缓冲
- 提供 `sendMessage()`、`stopStream()`、`loadSession()` 等操作
- 通过 `window.electronAPI.agent.`* 与后端智能体通信
- 监听 `agent:stream-chunk`、`agent:stream-done`、`agent:stream-error` 事件

### `ConfigProvider`

- 管理 AI 服务商配置（API Key、模型参数）
- 通过 `window.electronAPI.config.get/set` 读写持久化配置
- 在应用启动时自动加载用户配置

---

## 组件层级

```
App
└── ConfigProvider
    └── ChatProvider
        ├── WelcomePage           ← 未配置 API Key 时显示
        └── 主布局（ResizablePanels）
            ├── HistoryPanel      ← 左侧会话列表
            ├── ChatInterface     ← 中央聊天区域
            │   ├── ChatMessage（循环渲染）
            │   │   ├── StepResultBlocks
            │   │   │   ├── ImageBlock
            │   │   │   ├── AudioBlock
            │   │   │   └── DocumentBlock
            │   │   └── HitlConfirmBlock
            │   ├── TodoPanel
            │   └── QuickOptions / CaseList
            └── ArtifactViewer    ← 右侧产物面板
                └── WorkspacePanel
```

---

## 与后端通信

渲染进程**仅通过** `window.electronAPI`（由 `electron/preload.cjs` 注入）与主进程通信。详见 [ipc.md](./ipc.md)。

主要调用示例：

```typescript
// 发送消息给智能体
await window.electronAPI.agent.sendMessage(sessionId, message);

// 停止流式输出
window.electronAPI.agent.stopStream(sessionId);

// 读取配置
const config = await window.electronAPI.config.get();

// 创建新会话
const session = await window.electronAPI.session.create();

// 列出工作区文件
const files = await window.electronAPI.fs.ls(sessionId, '/');
```

---

## 构建与开发

```bash
# 开发模式（Vite HMR + Electron）
npm run electron:dev

# 生产构建（输出到 dist/）
tsc && vite build
```

Vite 配置位于 `[vite.config.ts](../../vite.config.ts)`，使用 `vite-plugin-electron` 将 `electron/main.ts` 和 `electron/preload.cjs` 一起构建。

---

## 关键设计原则

1. **进程隔离**：渲染进程零 Node.js 权限，所有系统操作经 IPC 委托给主进程
2. **流式优先**：AI 输出采用流式渲染，`ChatProvider` 缓冲 chunk 逐字显示
3. **会话隔离**：每个 `sessionId` 对应独立的工作区目录，UI 按 session 切换
4. **HITL 支持**：`HitlConfirmBlock` 可在智能体工作流关键节点暂停等待用户确认

