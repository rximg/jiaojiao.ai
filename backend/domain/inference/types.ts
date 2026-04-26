/**
 * 推理上下文类型（领域层定义，与 ai/types 对齐）
 */
import type { PromptInput } from './value-objects/prompt-input.js';

export interface ScriptLine {
  text: string;
  x: number;
  y: number;
}

/** 产物文件系统路径 */
export type ArtifactFilePath = string;
/** 产物 file:// URI */
export type ArtifactFileUri = string;
/** 远程 URL（如 provider 返回的图片地址） */
export type RemoteUrl = string;

export interface GenerateImageParams {
  /** 提示词：统一为 PromptInput，直接内容或从文件加载 */
  prompt: PromptInput;
  /** 输出文件名（可选），例如 rabbit_角色.png */
  imageName?: string;
  size?: string;
  style?: string;
  count?: number;
  model?: string;
  sessionId?: string;
  /** 负面提示词（由 tools 从 config/tools/t2i.yaml 传入） */
  negativePrompt?: string;
}

export interface GenerateImageResult {
  imagePath: ArtifactFilePath;
  imageUri: ArtifactFileUri;
  imageUrl?: RemoteUrl;
  sessionId: string;
}

export interface EditImageParams {
  /** 编辑指令：统一为 PromptInput，直接内容或从文件加载 */
  prompt: PromptInput;
  /** 参考图路径（支持 1..N 张） */
  imagePaths: ArtifactFilePath[];
  /** 输出文件名（可选），例如 scene_01.png */
  imageName?: string;
  size?: string;
  count?: number;
  model?: string;
  promptExtend?: boolean;
  watermark?: boolean;
  sessionId?: string;
}

export interface EditImageResult {
  imagePath: ArtifactFilePath;
  imageUri: ArtifactFileUri;
  imageUrl?: RemoteUrl;
  sessionId: string;
}

/** 单条 TTS 条目（由 tools 规划好 relativePath、可选 number 后传入端口） */
export interface SynthesizeSpeechItem {
  text: string;
  relativePath: string;
  /** 可选行号（tools 用 readLineNumbers 分配，端口原样返回供 appendEntries） */
  number?: number;
}

export interface SynthesizeSpeechParams {
  /** 已规划好的条目（tools 负责 readLineNumbers、规划路径后传入） */
  items: SynthesizeSpeechItem[];
  voice?: string;
  format?: string;
  sessionId?: string;
  /** 条间延迟（毫秒），由 tools 从 config/tools/tts.yaml 传入，属业务配置 */
  rateLimitMs?: number;
  /** 每完成一个文件时调用，用于前端显示 TTS 进度 */
  onProgress?: (current: number, total: number, path: string) => void;
}

export interface SynthesizeSpeechResult {
  audioPaths: ArtifactFilePath[];
  audioUris: ArtifactFileUri[];
  numbers: number[];
  sessionId: string;
}

export interface GenerateScriptFromImageParams {
  imagePath: ArtifactFilePath;
  sessionId?: string;
  /** 用户补充或修改要求（与系统 prompt 一起组成 VL 的完整提示词） */
  userPrompt?: string;
  /** 系统提示词（由 tools 从 config/tools/vl_script.yaml 读取后传入） */
  prompt?: string;
}

export interface GenerateScriptFromImageResult {
  lines: ScriptLine[];
  scriptPath?: ArtifactFilePath;
  sessionId: string;
}

// ---------------------------------------------------------------------------
// 各能力配置（由 getAIConfig 返回，构建 adapter 时使用）
// ---------------------------------------------------------------------------

export type Provider = 'dashscope' | 'zhipu' | 'jiaojiao';

export type AIAbility = 'llm' | 'vl' | 'tts' | 't2i' | 'image_edit';

export interface AIConfigBase {
  provider: Provider;
  apiKey: string;
}

/** 同步：仅 endpoint */
export interface LLMAIConfig extends AIConfigBase {
  /** 同步接口。base URL（如 chat/completions 前缀） */
  endpoint: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

/** 同步：仅 endpoint */
export interface VLAIConfig extends AIConfigBase {
  /** 同步接口。base URL */
  endpoint: string;
  model: string;
  prompt: string;
}

/** 同步仅 endpoint；异步（如通义）需 endpoint + taskEndpoint */
export interface TTSAIConfig extends AIConfigBase {
  endpoint: string;
  taskEndpoint?: string;
  model: string;
  /** 异步轮询间隔（毫秒），来自 ai_models.json */
  poll_interval_ms?: number;
  /** 异步轮询最大次数，来自 ai_models.json */
  max_poll_attempts?: number;
}

/** 异步：endpoint（提交）+ taskEndpoint（轮询） */
export interface T2IAIConfig extends AIConfigBase {
  endpoint: string;
  taskEndpoint: string;
  model: string;
  negativePrompt?: string;
  /** 文生图的 legacy 异步提交入口（如 wan2.6-t2i） */
  legacyEndpoint?: string;
  /** 轮询间隔（毫秒），来自 ai_models.json */
  poll_interval_ms?: number;
  /** 轮询最大次数，来自 ai_models.json */
  max_poll_attempts?: number;
}

/** 图像编辑（同步为主）：仅 endpoint；必要时可复用 taskEndpoint 做 legacy 轮询 */
export interface ImageEditAIConfig extends AIConfigBase {
  endpoint: string;
  model: string;
  taskEndpoint?: string;
  /** 轮询间隔（毫秒），来自 ai_models.json（仅当使用异步/legacy 时） */
  poll_interval_ms?: number;
  /** 轮询最大次数，来自 ai_models.json（仅当使用异步/legacy 时） */
  max_poll_attempts?: number;
}

export type AIConfig = LLMAIConfig | VLAIConfig | TTSAIConfig | T2IAIConfig | ImageEditAIConfig;

// ---------------------------------------------------------------------------
// ai_models.json：第一层级为 provider
// ---------------------------------------------------------------------------

export interface AiModelEntry {
  id: string;
  label?: string;
}

export interface ProviderAbilityModelsConfig {
  default: string;
  models: AiModelEntry[];
}

export type ProviderAbilityMap = {
  [K in AIAbility]: ProviderAbilityModelsConfig;
};

/** jiaojiao 网关在 ai_models.json 中的顶层配置（含额外元信息） */
export interface JiaojiaoProviderConfig extends Partial<ProviderAbilityMap> {
  /** 网关地址，如 http://jiaojiao.ai:9021 */
  gatewayUrl: string;
  /** 默认网关 SK，前端首次使用时自动填充 */
  defaultApiKey: string;
}

export type AiModelsSchema = {
  dashscope?: ProviderAbilityMap;
  zhipu?: ProviderAbilityMap;
  jiaojiao?: JiaojiaoProviderConfig;
};
