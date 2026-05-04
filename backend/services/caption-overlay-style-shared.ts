/**
 * 字幕叠层样式：纯函数与类型，供渲染与前端编辑器共用（无 Node/sharp 依赖）。
 */

export type CaptionBoxBackgroundId = 'light_frosted' | 'dark_frosted' | 'warm_white' | 'none';

export type CaptionBoxBorderId = 'white_soft' | 'none' | 'dark_thin' | 'dashed_white';

export const CAPTION_BOX_BACKGROUND_LABELS: Record<CaptionBoxBackgroundId, string> = {
  light_frosted: '浅色磨砂',
  dark_frosted: '深色磨砂',
  warm_white: '暖白半透明',
  none: '无背景',
};

export const CAPTION_BOX_BORDER_LABELS: Record<CaptionBoxBorderId, string> = {
  white_soft: '淡白细边',
  none: '无边框',
  dark_thin: '深色细边',
  dashed_white: '白虚线',
};

export function parseCaptionBoxBackgroundId(raw: unknown): CaptionBoxBackgroundId {
  if (
    raw === 'light_frosted' ||
    raw === 'dark_frosted' ||
    raw === 'warm_white' ||
    raw === 'none'
  ) {
    return raw;
  }
  return 'light_frosted';
}

export function parseCaptionBoxBorderId(raw: unknown): CaptionBoxBorderId {
  if (
    raw === 'white_soft' ||
    raw === 'none' ||
    raw === 'dark_thin' ||
    raw === 'dashed_white'
  ) {
    return raw;
  }
  return 'white_soft';
}

/** SVG / CSS 填充色；`none` 为透明 */
export function captionBackgroundFillCss(
  id: CaptionBoxBackgroundId,
  darkOpacity: number
): string {
  const a = Math.min(1, Math.max(0, darkOpacity));
  switch (id) {
    case 'light_frosted':
      return 'rgba(255,255,255,0.82)';
    case 'dark_frosted':
      return `rgba(28,28,28,${a})`;
    case 'warm_white':
      return 'rgba(255,248,238,0.88)';
    case 'none':
      return 'transparent';
  }
}

export interface SvgCaptionRectBorder {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
}

export function captionBorderForSvg(id: CaptionBoxBorderId): SvgCaptionRectBorder {
  switch (id) {
    case 'white_soft':
      return { stroke: 'rgba(255,255,255,0.45)', strokeWidth: 1 };
    case 'none':
      return { stroke: 'none', strokeWidth: 0 };
    case 'dark_thin':
      return { stroke: 'rgba(0,0,0,0.22)', strokeWidth: 1 };
    case 'dashed_white':
      return { stroke: 'rgba(255,255,255,0.5)', strokeWidth: 1, strokeDasharray: '6 4' };
  }
}
