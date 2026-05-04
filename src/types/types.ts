export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: "pending" | "completed" | "error" | "interrupted";
}

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
  updatedAt?: Date;
  artifacts?: {
    images?: Array<{ path: string; prompt?: string }>;
    audio?: Array<{ path: string; text?: string }>;
    llmOutput?: any;
  };
}

export interface Thread {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  lastMessage?: string;
}

/** 单条步骤结果，用于聊天流中渲染文档/图片/音频块 */
export type StepResult =
  | { type: 'image'; payload: { path: string; prompt?: string } }
  | { type: 'audio'; payload: { path: string; text?: string } }
  | { type: 'document'; payload: { pathOrContent: string; title?: string } };

/**
 * 聊天消息内嵌 HITL（pending 可编辑 + 持久化草稿；已决只读）
 * 旧存档可能仅有 `approved: boolean` 而无 `status`，仅用于只读展示。
 */
export interface HitlBlockRecord {
  requestId: string;
  actionType: string;
  payload: Record<string, unknown>;
  status?: 'pending' | 'approved' | 'rejected';
  /** 旧存档：无 `status` 时依此展示已继续/未继续 */
  approved?: boolean;
  draftEdits?: Record<string, unknown>;
  reason?: string;
  resolvedAt?: string;
}

/** 批量执行进度（从 IPC 接收） */
export interface BatchProgress {
  batchId: string;
  toolName: string;
  current: number;
  total: number;
  currentSubTask?: {
    index: number;
    label?: string;
    status: 'pending' | 'running' | 'completed' | 'error';
    result?: unknown;
    error?: string;
  };
}

/** 消息上的批量操作状态（展示 BatchWrapper 用） */
export interface BatchOperationState {
  batchId: string;
  toolName: string;
  total: number;
  current: number;
  subTasks: Array<{
    index: number;
    label?: string;
    status: 'pending' | 'running' | 'completed' | 'error';
    result?: unknown;
    error?: string;
  }>;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  /** 与该条消息关联的步骤结果（文档/图片/音频），由 agent:stepResult 写入 */
  stepResults?: StepResult[];
  /** TTS 进度：调用 synthesize_speech 时实时更新，前端显示「已生成 x/n 份文件」 */
  ttsProgress?: { current: number; total: number };
  /** 批量操作状态（统一展示所有批量工具的进度，替代 ttsProgress） */
  batchOperation?: BatchOperationState;
  /** 已结束的 HITL 确认块，用于在历史中显示并保留「继续/取消」结果 */
  hitlBlock?: HitlBlockRecord;
}

export interface Book {
  id: string;
  title: string;
  createdAt: string;
  premise: {
    age: number;
    theme: string;
    style: string;
    language: string;
  };
  images: Array<{
    path: string;
    prompt: string;
  }>;
  scripts: Array<{
    text: string;
    audioPath: string;
    order: number;
  }>;
}

export interface AppConfig {
  /** 配置版本号，与 package.json version 一致（如 "1.0.0"） */
  configVersion?: string;
  /** LLM 专用：按供应商区分的 API Key */
  apiKeys: {
    dashscope?: string;
    zhipu?: string;
  };
  /** 多模态（VL/TTS/T2I）专用：按供应商区分的 API Key */
  multimodalApiKeys?: {
    dashscope?: string;
    zhipu?: string;
    /** 嘉嘉本地网关 SK */
    jiaojiao?: string;
  };
  agent: {
    /** 当前使用的模型 id，为空时使用默认模型（见 ai_models.json） */
    model: string;
    /** 用户当前选择的模型，首次加载为空则使用默认模型 */
    current?: string;
    temperature: number;
    maxTokens: number;
    /** LLM 供应商：dashscope（阿里百炼）| zhipu（智谱） */
    provider?: 'dashscope' | 'zhipu';
    /** 多模态（VL/TTS/T2I）供应商，可与 LLM 不同 */
    multimodalProvider?: 'dashscope' | 'zhipu' | 'jiaojiao';
  };
  storage: {
    /** @deprecated 仅作兼容，新逻辑用 syncTargetPath。工作目录固定为 userData/workspace，不可配置。 */
    outputPath?: string;
    /** 音频同步目标路径：点击「同步」时，将工作目录下的音频复制到此目录。可配置，为空时同步会提示设置。 */
    syncTargetPath?: string;
    /** TTS 起始编号，如 6000，后续生成 6001、6002… */
    ttsStartNumber?: number;
  };
  ui: {
    theme: "light" | "dark";
    language: "zh" | "en";
    welcome?: WelcomeConfig;
    quickOptions?: QuickOption[];
    /** @deprecated 使用 quickOptions，YAML/后端兼容 */
    quick_options?: QuickOption[];
  };
  /** HITL 执行模式与自动通过列表 */
  hitl?: {
    mode?: 'auto' | 'allowlist' | 'strict';
    allowlist?: string[];
  };
}

export interface WelcomeConfig {
  title: string;
  subtitle: string;
  instructions: {
    title: string;
    items: string[];
  };
  footer: string;
}

export interface QuickOption {
  label: string;
  description: string;
  prompt: string;
}
