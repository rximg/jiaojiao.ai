/**
 * 仓储与端口工厂：创建并返回各仓储、端口实例，供后续依赖注入使用
 */
import { getWorkspaceFilesystem } from '../services/fs.js';
import { SessionFsRepository } from './persistence/session/session-fs-repository.js';
import { ArtifactFsRepository } from './persistence/workspace/artifact-fs-repository.js';
import { ConfigElectronStoreRepository } from './persistence/configuration/config-electron-store-repository.js';
import type { SessionRepository } from '#backend/domain/session/repositories/session-repository.js';
import type { ArtifactRepository } from '#backend/domain/workspace/repositories/artifact-repository.js';
import type { ConfigRepository } from '#backend/domain/configuration/repositories/config-repository.js';
import type { MultimodalPort } from '#backend/domain/inference/ports/multimodal-port.js';
import type { T2IAIConfig, TTSAIConfig, VLAIConfig, ImageEditAIConfig } from '#backend/domain/inference/types.js';
import { MultimodalPortImpl } from './inference/multimodal-port-impl.js';
import { getAIConfig } from './inference/ai-config.js';
import {
  createVLPort,
  createT2IPort,
  createEditImagePort,
  createTTSSyncPort,
} from './inference/create-ports.js';

let _sessionRepo: SessionRepository | null = null;
let _artifactRepo: ArtifactRepository | null = null;
let _configRepo: ConfigRepository | null = null;

/**
 * 获取会话仓储（单例）
 */
export function getSessionRepository(): SessionRepository {
  if (!_sessionRepo) {
    _sessionRepo = new SessionFsRepository(getWorkspaceFilesystem());
  }
  return _sessionRepo;
}

/**
 * 获取产物仓储（单例）
 */
export function getArtifactRepository(): ArtifactRepository {
  if (!_artifactRepo) {
    _artifactRepo = new ArtifactFsRepository(getWorkspaceFilesystem());
  }
  return _artifactRepo;
}

/**
 * 获取配置仓储（单例）
 */
export function getConfigRepository(): ConfigRepository {
  if (!_configRepo) {
    _configRepo = new ConfigElectronStoreRepository();
  }
  return _configRepo;
}

let _multimodalPortPromise: Promise<MultimodalPort> | null = null;

/**
 * 创建多模态端口（使用 getAIConfig 构建，供注入或单例使用）
 */
export async function createMultimodalPort(): Promise<MultimodalPort> {
  const [t2iCfg, imageEditCfg, ttsCfg, vlCfg] = await Promise.all([
    getAIConfig('t2i'),
    getAIConfig('image_edit'),
    getAIConfig('tts'),
    getAIConfig('vl'),
  ]);
  const t2i = t2iCfg as T2IAIConfig;
  const imageEdit = imageEditCfg as ImageEditAIConfig;
  const tts = ttsCfg as TTSAIConfig;
  const vl = vlCfg as VLAIConfig;
  const artifactRepo = getArtifactRepository();
  const workspace = getWorkspaceFilesystem();
  return new MultimodalPortImpl({
    vlPort: createVLPort(vl),
    t2iPort: createT2IPort(t2i),
    editImagePort: createEditImagePort(imageEdit),
    ttsSyncPort: createTTSSyncPort(tts),
    vlCfg: vl,
    t2iCfg: t2i,
    imageEditCfg: imageEdit,
    ttsCfg: tts,
    artifactRepo,
    getWorkspaceRoot: () => workspace.root,
  });
}

/**
 * 获取多模态端口（异步单例，首次调用时通过 getAIConfig 构建）
 */
export async function getMultimodalPortAsync(): Promise<MultimodalPort> {
  if (!_multimodalPortPromise) {
    _multimodalPortPromise = createMultimodalPort();
  }
  return _multimodalPortPromise;
}

/**
 * @deprecated 使用 getMultimodalPortAsync() 或注入的 MultimodalPort。保留仅为兼容，内部改为异步单例。
 */
export function getMultimodalPort(): MultimodalPort {
  throw new Error(
    'getMultimodalPort() 已废弃，请使用 getMultimodalPortAsync() 或通过 ToolContext 注入 MultimodalPort'
  );
}
