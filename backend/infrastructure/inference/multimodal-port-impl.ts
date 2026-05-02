/**
 * MultimodalPort 实现：通过 SyncInferencePort / AsyncInferencePort 调用 VL / T2I / TTS，仅 resolve、trace、写 workspace。
 */
import path from 'path';
import { pathToFileURL } from 'node:url';
import { promises as fs } from 'fs';
import { resolvePromptInput } from '#backend/domain/inference/value-objects/content-input.js';
import type {
  MultimodalPort,
  GenerateImageParams,
  GenerateImageResult,
  EditImageParams,
  EditImageResult,
  SynthesizeSpeechParams,
  SynthesizeSpeechResult,
  GenerateScriptFromImageParams,
  GenerateScriptFromImageResult,
  T2IAIConfig,
  ImageEditAIConfig,
  TTSAIConfig,
  VLAIConfig,
} from '#backend/domain/inference/index.js';
import type { ArtifactRepository } from '#backend/domain/workspace/repositories/artifact-repository.js';
import { traceAiRun } from '../../agent/langsmith-trace.js';
import { pcmToMp3, pcmToWav } from '../../services/audio-format.js';
import type { VLPort, T2IPort, EditImagePort, TTSSyncPort } from './create-ports.js';
import { parseVlScriptLinesFromModelContent } from './vl-script-response.js';

const DEFAULT_SESSION_ID = 'default';

const VL_FALLBACK_PROMPT = `你是一个有声绘本台词设计师，找出图片中的元素，给每个元素设计一个台词。返回一个列表，列表里是台词和对应元素坐标，坐标原点为图片左上角。 格式为：[{"text": "台词", "x": "x坐标", "y": "y坐标"}]`;

export interface MultimodalPortImplDeps {
  vlPort: VLPort;
  t2iPort: T2IPort;
  editImagePort: EditImagePort;
  /** 同步 TTS：智谱返回 PCM，通义返回 audioUrl */
  ttsSyncPort: TTSSyncPort;
  vlCfg: VLAIConfig;
  t2iCfg: T2IAIConfig;
  imageEditCfg: ImageEditAIConfig;
  ttsCfg: TTSAIConfig;
  artifactRepo: ArtifactRepository;
  getWorkspaceRoot: () => string;
}

function resolveImageAbsolutePath(
  imagePath: string,
  sessionId: string,
  workspaceRoot: string
): string {
  const normalized = imagePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const workspacesMatch = normalized.match(/outputs\/workspaces\/([^/]+)\/(.+)$/);
  if (workspacesMatch) {
    const sid = workspacesMatch[1];
    const rel = workspacesMatch[2];
    const targetSessionId = sid === sessionId ? sessionId : sid;
    return path.join(workspaceRoot, targetSessionId, rel);
  }
  if (path.isAbsolute(imagePath)) {
    return imagePath;
  }
  return path.join(workspaceRoot, sessionId, normalized);
}

async function readImageAsBase64(absolutePath: string): Promise<{ base64: string; mime: string }> {
  const ext = path.extname(absolutePath).toLowerCase();
  const mime =
    ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
  const buffer = await fs.readFile(absolutePath);
  return { base64: buffer.toString('base64'), mime };
}

function resolveImageOutputRelativePath(
  imageName: string | undefined,
  fixedDir: string,
  fallbackPrefix: string
): string {
  const raw = (imageName ?? '').trim();
  const baseName = raw.replace(/\\/g, '/').split('/').pop()?.trim() ?? '';

  if (!baseName) {
    return path.posix.join(
      fixedDir,
      `${fallbackPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.png`
    );
  }

  const ext = path.posix.extname(baseName);
  const finalName = ext ? baseName : `${baseName}.png`;
  return path.posix.join(fixedDir, finalName);
}

function buildImagePathCandidates(
  imagePath: string,
  sessionId: string,
  workspaceRoot: string
): string[] {
  const candidates = [resolveImageAbsolutePath(imagePath, sessionId, workspaceRoot)];
  const normalized = imagePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const isOutputsRelative = /^outputs\/workspaces\//.test(normalized);
  const basename = normalized.split('/').pop()?.trim();

  if (!path.isAbsolute(imagePath) && !isOutputsRelative && basename) {
    if (normalized.startsWith('scenes/')) {
      candidates.push(path.join(workspaceRoot, sessionId, 'images', basename));
    }
    if (normalized.startsWith('characters/')) {
      candidates.push(path.join(workspaceRoot, sessionId, 'images', basename));
    }
  }

  return Array.from(new Set(candidates));
}

async function resolveFirstExistingImagePath(candidates: string[]): Promise<string> {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error(`Image file not found: ${candidates[0]}`);
}

function formatDownloadFetchError(kind: 'T2I' | 'ImageEdit', targetUrl: string, error: unknown): Error {
  const err = error as {
    message?: string;
    cause?: { code?: string; hostname?: string; message?: string };
  };
  const cause = err?.cause;
  if (cause?.code === 'ENOTFOUND' && cause.hostname === 'z-image-turbo') {
    return new Error(
      `${kind} image download failed: upstream returned Docker internal host \"z-image-turbo\". ` +
        `Please set Z_IMAGE_PUBLIC_URL to a host-reachable URL (for example http://localhost:9021/z-image-turbo).`
    );
  }
  return new Error(
    `${kind} image download failed from ${targetUrl}: ${err?.message ?? cause?.message ?? String(error)}`
  );
}

export class MultimodalPortImpl implements MultimodalPort {
  private readonly workspaceFsLike = {
    sessionPath: (sessionId: string, rel: string) =>
      this.deps.artifactRepo.resolvePath(sessionId, rel),
  };

  constructor(private readonly deps: MultimodalPortImplDeps) {}

  private async downloadRemoteImageBuffer(kind: 'T2I' | 'ImageEdit', imageUrl: string): Promise<Buffer> {
    let imageRes: Response;
    try {
      imageRes = await fetch(imageUrl);
    } catch (error) {
      throw formatDownloadFetchError(kind, imageUrl, error);
    }
    if (!imageRes.ok) {
      const label = kind === 'T2I' ? 'T2I image download failed' : 'Edited image download failed';
      throw new Error(`${label}: ${imageRes.status} ${imageRes.statusText}`);
    }
    return Buffer.from(await imageRes.arrayBuffer());
  }

  async generateImage(params: GenerateImageParams): Promise<GenerateImageResult> {
    const sessionId = params.sessionId ?? DEFAULT_SESSION_ID;
    const promptStr = await resolvePromptInput(
      params.prompt,
      sessionId,
      this.workspaceFsLike
    );
    const { size = '1024*1024', style, count = 1 } = params;
    const cfg = this.deps.t2iCfg;
    const negativePrompt = [cfg.negativePrompt, params.negativePrompt, style].filter(Boolean).join(', ') || undefined;

    const inputs = {
      promptLength: promptStr.length,
      imageName: params.imageName,
      size,
      count,
      sessionId,
      provider: cfg.provider,
      model: cfg.model,
    };

    return traceAiRun(
      'inference.t2i',
      'tool',
      inputs,
      async () =>
        this.generateImageImpl(
          promptStr,
          sessionId,
          size,
          count,
          negativePrompt,
          params.imageName
        ),
      (result) => ({
        imagePath: result.imagePath,
        imageUri: result.imageUri,
        imageUrl: result.imageUrl,
        sessionId: result.sessionId,
        _note: 'blob not recorded',
      })
    );
  }

  private async generateImageImpl(
    prompt: string,
    sessionId: string,
    size: string,
    count: number,
    negativePrompt?: string,
    imageName?: string
  ): Promise<GenerateImageResult> {
    const cfg = this.deps.t2iCfg;
    const parameters: Record<string, unknown> =
      cfg.provider === 'zhipu'
        ? {
            size: size.replace(/\*/g, 'x'),
            quality: 'hd',
            negative_prompt: negativePrompt,
          }
        : {
            size,
            max_images: count,
            enable_interleave: true,
            negative_prompt: negativePrompt,
          };
    const taskId = await this.deps.t2iPort.submit({ prompt, parameters });
    const imageUrl = await this.deps.t2iPort.poll(taskId);

    const buffer = await this.downloadRemoteImageBuffer('T2I', imageUrl);
    const relativePath = resolveImageOutputRelativePath(imageName, 'images', 'image');
    await this.deps.artifactRepo.write(sessionId, relativePath, buffer);
    const imagePath = this.deps.artifactRepo.resolvePath(sessionId, relativePath);
    const imageUri = pathToFileURL(imagePath).href;

    return {
      imagePath,
      imageUri,
      imageUrl,
      sessionId,
    };
  }

  async synthesizeSpeech(params: SynthesizeSpeechParams): Promise<SynthesizeSpeechResult> {
    const { items, voice = 'chinese_female', format = 'mp3', sessionId = DEFAULT_SESSION_ID, rateLimitMs, onProgress } = params;
    const cfg = this.deps.ttsCfg;

    const inputs = {
      itemsCount: items.length,
      voice,
      format,
      sessionId,
      provider: cfg.provider,
      model: cfg.model,
    };

    const delayMs = rateLimitMs ?? 2000;
    return traceAiRun(
      'inference.tts',
      'tool',
      inputs,
      () => this.synthesizeSpeechImpl(items, voice, format, sessionId, delayMs, onProgress),
      (result) => ({
        audioPathsCount: result.audioPaths.length,
        audioPaths: result.audioPaths,
        numbers: result.numbers,
        sessionId: result.sessionId,
        _note: 'audio blob not recorded',
      })
    );
  }

  async editImage(params: EditImageParams): Promise<EditImageResult> {
    const sessionId = params.sessionId ?? DEFAULT_SESSION_ID;
    if (!Array.isArray(params.imagePaths) || params.imagePaths.length === 0) {
      throw new Error('edit_image requires at least one image path');
    }

    const promptStr = await resolvePromptInput(
      params.prompt,
      sessionId,
      this.workspaceFsLike
    );

    const size = params.size ?? '1280*1280';
    const count = Math.max(1, Math.min(4, params.count ?? 1));
    const promptExtend = params.promptExtend ?? true;
    const watermark = params.watermark ?? false;

    const cfg = this.deps.imageEditCfg;
    const inputs = {
      promptLength: promptStr.length,
      imageCount: params.imagePaths.length,
      imageName: params.imageName,
      size,
      count,
      promptExtend,
      watermark,
      sessionId,
      provider: cfg.provider,
      model: cfg.model,
    };

    return traceAiRun(
      'inference.image_edit',
      'tool',
      inputs,
      async () => {
        const workspaceRoot = this.deps.getWorkspaceRoot();
        const imageDataUrls: string[] = [];
        for (const imagePath of params.imagePaths) {
          const absolutePath = await resolveFirstExistingImagePath(
            buildImagePathCandidates(imagePath, sessionId, workspaceRoot)
          );
          const { base64, mime } = await readImageAsBase64(absolutePath);
          imageDataUrls.push(`data:${mime};base64,${base64}`);
        }

        const result = await this.deps.editImagePort.execute({
          model: params.model,
          prompt: promptStr,
          imageDataUrls,
          parameters: {
            size,
            n: count,
            prompt_extend: promptExtend,
            watermark,
            enable_interleave: false,
          },
        });

        const buffer = await this.downloadRemoteImageBuffer('ImageEdit', result.imageUrl);
        const relativePath = resolveImageOutputRelativePath(params.imageName, 'images', 'scene');
        await this.deps.artifactRepo.write(sessionId, relativePath, buffer);
        const imagePath = this.deps.artifactRepo.resolvePath(sessionId, relativePath);
        const imageUri = pathToFileURL(imagePath).href;

        return {
          imagePath,
          imageUri,
          imageUrl: result.imageUrl,
          sessionId,
        };
      },
      (result) => ({
        imagePath: result.imagePath,
        imageUri: result.imageUri,
        imageUrl: result.imageUrl,
        sessionId: result.sessionId,
        _note: 'blob not recorded',
      })
    );
  }

  private async synthesizeSpeechImpl(
    items: SynthesizeSpeechParams['items'],
    voice: string,
    format: string,
    sessionId: string,
    delayMs: number,
    onProgress?: (current: number, total: number, path: string) => void
  ): Promise<SynthesizeSpeechResult> {
    const audioPaths: string[] = [];
    const audioUris: string[] = [];
    for (let i = 0; i < items.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
      const { text, relativePath } = items[i];
      const { audioPath, audioUri } = await this.synthesizeSpeechSingleItem(
        text,
        voice,
        format,
        sessionId,
        relativePath
      );
      audioPaths.push(audioPath);
      audioUris.push(audioUri);
      if (onProgress) {
        onProgress(i + 1, items.length, audioPath);
      }
    }

    const numbers = items.map((it) => it.number).filter((n): n is number => n !== undefined);

    return {
      audioPaths,
      audioUris,
      numbers: numbers.length ? numbers : items.map((_, idx) => idx),
      sessionId,
    };
  }

  /** 合成单条语音并写入 artifact（仅由 synthesizeSpeech 批量路径调用） */
  private async synthesizeSpeechSingleItem(
    text: string,
    voice: string,
    format: string,
    sessionId: string,
    relativePath: string
  ): Promise<{ audioPath: string; audioUri: string }> {
    const ttsSync = this.deps.ttsSyncPort;
    const result = await ttsSync.execute({ text, voice });
    let buffer: Buffer;
    if ('audioUrl' in result && result.audioUrl) {
      const res = await fetch(result.audioUrl);
      if (!res.ok) {
        throw new Error(`TTS audio download failed: ${res.status} ${res.statusText}`);
      }
      buffer = Buffer.from(await res.arrayBuffer());
    } else if ('pcmBuffer' in result) {
      const { pcmBuffer, sampleRate, channels } = result;
      buffer =
        format === 'wav'
          ? pcmToWav(pcmBuffer, { sampleRate, channels })
          : await pcmToMp3(pcmBuffer, { sampleRate, channels });
    } else {
      throw new Error('TTS sync port returned unexpected result shape');
    }
    await this.deps.artifactRepo.write(sessionId, relativePath, buffer);
    const absPath = this.deps.artifactRepo.resolvePath(sessionId, relativePath);
    return {
      audioPath: absPath,
      audioUri: pathToFileURL(absPath).href,
    };
  }

  async generateScriptFromImage(
    params: GenerateScriptFromImageParams
  ): Promise<GenerateScriptFromImageResult> {
    const sessionId = params.sessionId ?? DEFAULT_SESSION_ID;
    const cfg = this.deps.vlCfg;
    const inputs = {
      imagePath: params.imagePath,
      sessionId,
      provider: cfg.provider,
      model: cfg.model,
    };

    return traceAiRun(
      'inference.vl',
      'tool',
      inputs,
      () => this.generateScriptFromImageImpl(params),
      (result) => ({
        linesCount: result.lines.length,
        scriptPath: result.scriptPath,
        sessionId: result.sessionId,
        _note: 'image and lines not recorded',
      })
    );
  }

  private async generateScriptFromImageImpl(
    params: GenerateScriptFromImageParams
  ): Promise<GenerateScriptFromImageResult> {
    const sessionId = params.sessionId ?? DEFAULT_SESSION_ID;
    const workspaceRoot = this.deps.getWorkspaceRoot();
    const absolutePath = await resolveFirstExistingImagePath(
      buildImagePathCandidates(params.imagePath, sessionId, workspaceRoot)
    );

    const { base64, mime } = await readImageAsBase64(absolutePath);
    const dataUrl = `data:${mime};base64,${base64}`;
    const prompt =
      params.prompt?.trim() ||
      this.deps.vlCfg.prompt?.trim() ||
      VL_FALLBACK_PROMPT;
    const fullPrompt = params.userPrompt?.trim()
      ? `${prompt}\n\n用户补充或修改要求：\n${params.userPrompt.trim()}`
      : prompt;

    const content = await this.deps.vlPort.execute({
      dataUrl,
      prompt: fullPrompt,
    });

    const lines = parseVlScriptLinesFromModelContent(content);
    const imageBasename = path.basename(absolutePath, path.extname(absolutePath));
    const scriptRelativePath = `lines/${imageBasename}.json`;
    await this.deps.artifactRepo.write(
      sessionId,
      scriptRelativePath,
      JSON.stringify(lines, null, 2)
    );
    const scriptPath = this.deps.artifactRepo.resolvePath(sessionId, scriptRelativePath);

    return { lines, scriptPath, sessionId };
  }
}
