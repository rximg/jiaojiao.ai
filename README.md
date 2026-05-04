# ♪iao♪iao有声绘本智能体


基于 Electron + React + deepagentsjs 的有声绘本智能生成应用。

![jiaojiao logo](assets/logo.jpg)

## 技术栈

- **前端**: Electron + React + TypeScript + ShadCN UI
- **后端**: deepagents.js（基于 LangChain/LangGraph），运行在 Electron 主进程，通过 IPC 与渲染进程通信
- **AI 模型**: 通义（阿里百炼）/ 智谱，支持 LLM、T2I（文生图）、TTS（语音合成）、VL（以图生剧本）

## 项目结构

```
app/
├── electron/              # Electron 主进程
│   ├── main.ts           # 主进程入口
│   ├── preload.ts        # 预加载脚本
│   └── ipc/              # IPC 通道（session、agent、config、fs、hitl、sync、storage）
├── src/                   # React 前端
│   ├── app/              # 应用组件
│   ├── components/       # 共享组件与 ShadCN UI
│   ├── providers/        # Context Providers
│   ├── types/            # TypeScript 类型
│   └── lib/              # 工具函数
├── backend/              # 后端（DDD 分层，见 docs/后端软件架构.md）
│   ├── agent/            # Agent 核心（AgentFactory、ConfigLoader、LangSmith）
│   ├── application/      # 应用层用例（session CRUD、invoke-agent）
│   ├── domain/           # 领域层（inference、session、workspace、configuration）
│   ├── infrastructure/   # 基础设施（推理 adapters、仓储实现）
│   ├── tools/            # 工具实现与 registry（config/tools/*.yaml 驱动）
│   ├── services/         # 运行时、持久化、HITL、日志等
│   ├── config/           # main_agent_config.yaml、ai_models.json、tools、sub_agents
│   └── app-config.ts     # 应用配置（electron-store）
└── package.json
```

后端分层与模块说明见 **[docs/后端软件架构.md](docs/后端软件架构.md)**。

## 快速开始

### 1. 安装依赖

```bash
cd app
npm install
```

**FFmpeg（TTS 智谱 PCM→MP3 必需）**：使用智谱 TTS 并输出 MP3 时，需在系统安装 FFmpeg，否则会提示“请安装 ffmpeg 后重试”。

| 平台 | 安装方式 |
|------|----------|
| Windows | `winget install ffmpeg` 或从 [ffmpeg.org](https://ffmpeg.org/download.html) 下载并加入 PATH |
| macOS | `brew install ffmpeg` |
| Linux | `sudo apt install ffmpeg`（Debian/Ubuntu）或 `sudo yum install ffmpeg`（CentOS/RHEL） |

> 计划中：支持在应用内自动下载/安装 FFmpeg，见开发说明。

如果遇到依赖冲突，可以使用：

```bash
npm install --legacy-peer-deps
```

### 2. 配置环境变量

创建 `.env` 文件（可选，也可以通过应用内配置界面设置）：

```env
DASHSCOPE_API_KEY=你的阿里百炼API Key
DASHSCOPE_MODEL=qwen-plus
# 可选：为文生图/语音单独配置模型与端点（你的账户权限为准）
# 文生图（T2I）
DASHSCOPE_T2I_MODEL=wan2.6-i2v
DASHSCOPE_T2I_ENDPOINT=https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
# 语音合成（TTS）
DASHSCOPE_TTS_MODEL=sambert-zhichu-v1
DASHSCOPE_TTS_ENDPOINT=https://dashscope.aliyuncs.com/api/v1/services/audio/tts
```

### 3. 开发模式运行

```bash
npm run electron:dev
```

这将同时启动 Vite 开发服务器和 Electron 应用。

### 4. 构建应用

```bash
npm run electron:build
```

### 5. 运行测试（含集成测试与供应商选择）

API Key 来自应用设置（用户目录配置）。集成测试会调用真实接口，需在应用中配置 Key；可通过环境变量选择只测智谱或只测通义：

```bash
# 全量测试（不调真实 API 的用例）
npm run test:run

# 推理集成测试（LLM、VL、T2I、TTS）
npm run test:inference
npm run test:inference:zhipu    # 仅智谱
npm run test:inference:dashscope # 仅通义

# 工具集成测试（文生图、语音合成等）
npm run test:tools
npm run test:tools:zhipu
npm run test:tools:dashscope

# Agent 集成测试（创建 Agent、完整 invoke 流程）
npm run test:agent
```

环境变量：`TEST_API_PROVIDER=zhipu` 或 `dashscope` 可限定本次使用的 provider；不设则使用应用配置中的默认 provider。

测试位置：`tests/integration/inference/`、`tests/integration/tools/`、`tests/integration/agent/`。

## 功能特性

### 欢迎界面
- 配置栏：快速访问配置
- 历史记录：查看历史对话
- 案例列表：选择可用案例（当前支持"百科绘本"）

### 聊天界面
- 欢迎词：进入聊天时显示欢迎消息
- 对话消息：支持流式显示 AI 回复
- 快捷选项：预设常用操作
- 工具调用：显示 Agent 工具调用状态
- Todos：显示任务进度（deepagentsjs 内置）

### 配置界面
- API Key 配置（阿里百炼、T2I、TTS）
- Agent 参数配置（模型、温度、最大 Token）
- 存储路径配置

## 使用说明

1. **首次使用**：打开应用后，会提示配置 API Key
2. **选择案例**：在欢迎界面点击"百科绘本"案例
3. **开始对话**：
   - 直接输入需求（如"3岁森林主题绘本"）
   - 或点击快捷选项快速开始
4. **查看结果**：Agent 会自动生成图片、台词和语音

## 技术说明

### deepagentsjs 集成

本项目使用 [deepagentsjs](https://github.com/langchain-ai/deepagentsjs) 作为后端 Agent 框架：

- **核心功能**：规划工具、文件系统、子代理
- **工具定义**：使用 `tool` 从 `langchain` 创建结构化工具
- **子代理**：使用 `SubAgent` 类型定义专门的子代理
- **流式响应**：支持 LangGraph 的流式 API

### Agent 工作流程

1. **生成提示词**：将用户输入委派给 `prompt_generator` 子代理（task description 传入用户回答），写入 `image_prompt.txt`
2. **生成图片**：调用 `generate_image` 工具（T2I，config/tools/t2i.yaml）
3. **生成台词**：调用 `generate_script_from_image` 工具（VL：根据图片生成台词与坐标，config/tools/vl_script.yaml）
4. **生成语音**：调用 `synthesize_speech` 工具（config/tools/tts.yaml）
5. **标注与收尾**：`annotate_image_numbers`、`finalize_workflow`，返回完整绘本

### 后端架构摘要

- **通信**：桌面端仅通过 **Electron IPC** 与主进程交互（session、agent、config、fs、hitl 等），无独立 HTTP 服务。
- **配置驱动**：主 Agent、工具、子代理均由 `backend/config/main_agent_config.yaml` 及 `config/tools/*.yaml`、`config/sub_agents/*.yaml` 配置。
- **分层**：应用层用例（application/agent）→ 领域层（domain）→ 基础设施（infrastructure），详见 [docs/后端软件架构.md](docs/后端软件架构.md)。

## 开发说明

### 添加新工具

1. 在 `backend/tools/` 中实现工具逻辑，并在 `backend/tools/registry.ts` 中注册（供 AgentFactory 通过 `createTool(name, config, context)` 使用）。
2. 在 `backend/config/main_agent_config.yaml` 的 **tools** 段增加条目；若需业务参数，在 `backend/config/tools/` 下新增 YAML（如 `my_tool.yaml`），并设置 `config_path: ./tools/my_tool.yaml`。

### 添加新子代理

1. 在 `backend/config/sub_agents/` 下新增子代理 YAML（提示词与配置）。
2. 在 `backend/config/main_agent_config.yaml` 的 **sub_agents** 段增加条目（name、description、config_path 等）。

### 计划中

- **FFmpeg 的下载与安装**：在应用内或通过脚本实现 FFmpeg 的自动下载与安装，避免用户手动配置 PATH。

## 注意事项

- 确保已获取通义/智谱 API Key 并在应用内配置
- 首次使用需要配置 API Key
- 生成的内容按会话保存在工作空间（userData/workspace 或配置的输出目录）
- 应用配置保存在 userData 目录（如 `config.json`）
- 需要 Node.js 18+ 和兼容的 LangChain / deepagents.js 版本

## 故障排除

### 依赖安装失败

如果遇到依赖冲突，使用：

```bash
npm install --legacy-peer-deps
```

### TTS 报错「请安装 ffmpeg 后重试」

- 在终端执行 `ffmpeg -version` 确认是否已安装并在 PATH 中
- 按上文「快速开始 → 安装依赖」中的表格安装 FFmpeg 并重启应用

### API 调用失败

- 检查 API Key 是否正确配置
- 检查网络连接
- 查看控制台错误信息

### Agent 无法启动

- 检查 deepagentsjs 是否正确安装
- 检查 LangChain 版本是否兼容
- 查看 Electron 主进程日志

## 参考资源

- [deepagentsjs 文档](https://docs.langchain.com/oss/javascript/deepagents/overview)
- [deepagentsjs GitHub](https://github.com/langchain-ai/deepagentsjs)
- [LangChain 文档](https://js.langchain.com/)

## 许可证

本项目采用 [BSD 3-Clause License](LICENCE)。Copyright (c) 2026, rximg/jiaojiao。
