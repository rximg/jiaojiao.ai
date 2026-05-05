import path from 'path';
import { promises as fs } from 'fs';
import sharp from 'sharp';
import { DEFAULT_SESSION_ID, getWorkspaceFilesystem } from './fs.js';
import {
  captionBackgroundFillCss,
  captionBorderForSvg,
  parseCaptionBoxBackgroundId,
  parseCaptionBoxBorderId,
  type CaptionBoxBackgroundId,
  type CaptionBoxBorderId,
} from './caption-overlay-style-shared.js';

export type { CaptionBoxBackgroundId, CaptionBoxBorderId };

export interface CaptionOverlayStyleParams {
  captionTextFontSizePx: number;
  captionRubyFontSizePx: number;
  captionTextColor: string;
  captionRubyColor: string;
  fontFamily: string;
  textStrokeWidth: number;
  textStrokeColor: string;
  /** 0–1，仅对「深色磨砂」底衬生效 */
  boxBackgroundOpacity: number;
  boxPaddingPx: number;
  captionBoxBackground: CaptionBoxBackgroundId;
  captionBoxBorder: CaptionBoxBorderId;
}

export interface CaptionOverlayBoxInput {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  items: Array<{ char: string; reading: string }>;
}

export const DEFAULT_CAPTION_OVERLAY_STYLE: CaptionOverlayStyleParams = {
  captionTextFontSizePx: 64,
  captionRubyFontSizePx: 24,
  captionTextColor: '#2d2d2d',
  captionRubyColor: '#5c5c5c',
  fontFamily: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
  textStrokeWidth: 0.6,
  textStrokeColor: 'rgba(0,0,0,0.35)',
  boxBackgroundOpacity: 0.72,
  boxPaddingPx: 8,
  captionBoxBackground: 'none',
  captionBoxBorder: 'none',
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildBoxFragment(box: CaptionOverlayBoxInput, style: CaptionOverlayStyleParams): string {
  const { x, y, w, h, items } = box;
  const pad = style.boxPaddingPx;
  const rubySize = style.captionRubyFontSizePx;
  const textSize = style.captionTextFontSizePx;
  const colGap = 3;
  const rowGap = 4;
  const stroke = style.textStrokeWidth > 0
    ? `stroke="${escapeXml(style.textStrokeColor)}" stroke-width="${style.textStrokeWidth}"`
    : '';

  let cursorX = x + pad;
  const maxX = x + w - pad;
  const fragments: string[] = [];

  const bgId = parseCaptionBoxBackgroundId(style.captionBoxBackground);
  const borderId = parseCaptionBoxBorderId(style.captionBoxBorder);
  const fillRaw = captionBackgroundFillCss(bgId, style.boxBackgroundOpacity);
  const fillAttr = fillRaw === 'transparent' ? 'fill="none"' : `fill="${escapeXml(fillRaw)}"`;
  const b = captionBorderForSvg(borderId);
  const dashAttr = b.strokeDasharray ? ` stroke-dasharray="${b.strokeDasharray}"` : '';

  fragments.push(
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" ry="10" ${fillAttr} stroke="${escapeXml(b.stroke)}" stroke-width="${b.strokeWidth}"${dashAttr} />`
  );

  for (const it of items) {
    const colW = Math.max(textSize, rubySize) * 0.92;
    if (cursorX + colW > maxX) break;
    const mid = cursorX + colW / 2;
    const rubyY = y + pad + rubySize;
    const textY = y + pad + rubySize + rowGap + textSize;
    const r = escapeXml(it.reading || '\u00a0');
    const c = escapeXml(it.char);
    fragments.push(
      `<text x="${mid}" y="${rubyY}" text-anchor="middle" dominant-baseline="middle" font-size="${rubySize}" font-family="${escapeXml(style.fontFamily)}" fill="${escapeXml(style.captionRubyColor)}" ${stroke}>${r}</text>`
    );
    fragments.push(
      `<text x="${mid}" y="${textY}" text-anchor="middle" dominant-baseline="middle" font-size="${textSize}" font-family="${escapeXml(style.fontFamily)}" fill="${escapeXml(style.captionTextColor)}" ${stroke}>${c}</text>`
    );
    cursorX += colW + colGap;
  }

  return `<g>${fragments.join('\n')}</g>`;
}

/** 供测试与调试：整幅图尺寸的 SVG 片段 */
export function buildCaptionOverlaySvg(
  imageWidth: number,
  imageHeight: number,
  boxes: CaptionOverlayBoxInput[],
  style: CaptionOverlayStyleParams
): string {
  const inner = boxes.map((b) => buildBoxFragment(b, style)).join('\n');
  return `<svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg">\n${inner}\n</svg>`;
}

function resolveImageAbsolutePath(imagePath: string, sessionId: string, workspaceRoot: string): string {
  const normalized = imagePath.replace(/\\/g, '/');
  if (path.isAbsolute(imagePath)) {
    return imagePath;
  }
  const workspacesMatch = normalized.match(/workspaces\/([^/]+)\/(.+)$/);
  if (workspacesMatch) {
    const sid = workspacesMatch[1];
    const rel = workspacesMatch[2];
    const targetSessionId = sid === sessionId ? sessionId : sid;
    return path.join(workspaceRoot, targetSessionId, rel);
  }
  return path.join(workspaceRoot, sessionId, normalized);
}

export interface ComposeCaptionOverlayImageParams {
  imagePath: string;
  sessionId?: string;
  boxes: CaptionOverlayBoxInput[];
  style: CaptionOverlayStyleParams;
  /** 相对 session 的输出路径，默认 images/<basename>_caption.png */
  outputRelativePath?: string;
}

export interface ComposeCaptionOverlayImageResult {
  imagePath: string;
  imageUri: string;
  sessionId: string;
}

export async function composeCaptionOverlayImage(
  params: ComposeCaptionOverlayImageParams
): Promise<ComposeCaptionOverlayImageResult> {
  const sessionId = params.sessionId ?? DEFAULT_SESSION_ID;
  const workspaceFs = getWorkspaceFilesystem({});
  const workspaceRoot = workspaceFs.root;

  const absolutePath = resolveImageAbsolutePath(params.imagePath, sessionId, workspaceRoot);
  await fs.access(absolutePath);

  const image = sharp(absolutePath);
  const meta = await image.metadata();
  const width = meta.width ?? 1024;
  const height = meta.height ?? 1024;

  const svg = Buffer.from(buildCaptionOverlaySvg(width, height, params.boxes, params.style), 'utf-8');
  const composed = await image.composite([{ input: svg, blend: 'over' }]).png().toBuffer();

  let relativeOut: string;
  if (params.outputRelativePath?.trim()) {
    relativeOut = params.outputRelativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  } else {
    const basename = path.basename(absolutePath, path.extname(absolutePath));
    relativeOut = path.posix.join('images', `${basename}_caption.png`);
  }

  const outAbsolutePath = await workspaceFs.writeFile(sessionId, relativeOut, composed);
  const imageUri = workspaceFs.toFileUri(outAbsolutePath);

  return {
    imagePath: outAbsolutePath,
    imageUri,
    sessionId,
  };
}
