/**
 * 字幕区：VL 归一化矩形 ↔ 像素矩形（与 annotate 数字标注一致的 clamp）
 */

export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_BOX_W = 20;
const MIN_BOX_H = 20;

/** 无 w/h 时按行数在画面中下部分配默认条带（归一化） */
export function defaultNormalizedCaptionRect(lineIndex: number, lineCount: number): NormalizedRect {
  const n = Math.max(1, lineCount);
  const slot = 0.85 / n;
  const h = Math.min(0.12, slot * 0.85);
  const y = 0.88 - (lineIndex + 1) * slot;
  return { x: 0.05, y: Math.max(0.02, y), w: 0.9, h };
}

export function clampPixelRect(r: PixelRect, imageWidth: number, imageHeight: number): PixelRect {
  let { x, y, w, h } = r;
  w = Math.max(MIN_BOX_W, Math.min(w, imageWidth));
  h = Math.max(MIN_BOX_H, Math.min(h, imageHeight));
  x = Math.max(0, Math.min(x, imageWidth - w));
  y = Math.max(0, Math.min(y, imageHeight - h));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

export function normalizedRectToPixelRect(
  norm: NormalizedRect,
  imageWidth: number,
  imageHeight: number
): PixelRect {
  const x = norm.x * imageWidth;
  const y = norm.y * imageHeight;
  const w = norm.w * imageWidth;
  const h = norm.h * imageHeight;
  return clampPixelRect({ x, y, w, h }, imageWidth, imageHeight);
}
