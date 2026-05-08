import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react';
import {
  CAPTION_BOX_BACKGROUND_LABELS,
  CAPTION_BOX_BORDER_LABELS,
  captionBackgroundFillCss,
  parseCaptionBoxBackgroundId,
  parseCaptionBoxBorderId,
  type CaptionBoxBackgroundId,
  type CaptionBoxBorderId,
} from '#backend/services/caption-overlay-style-shared.js';

export interface CaptionOverlayBoxState {
  lineIndex: number;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  items: Array<{ char: string; reading: string }>;
}

export interface CaptionOverlayEditorStyleState {
  captionTextFontSizePx: number;
  captionRubyFontSizePx: number;
  captionTextColor: string;
  captionRubyColor: string;
  fontFamily: string;
  textStrokeWidth: number;
  textStrokeColor: string;
  boxBackgroundOpacity: number;
  boxPaddingPx: number;
  captionBoxBackground: CaptionBoxBackgroundId;
  captionBoxBorder: CaptionBoxBorderId;
}

export const DEFAULT_CAPTION_OVERLAY_EDITOR_STYLE: CaptionOverlayEditorStyleState = {
  captionTextFontSizePx: 28,
  captionRubyFontSizePx: 14,
  captionTextColor: '#2d2d2d',
  captionRubyColor: '#5c5c5c',
  fontFamily: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
  textStrokeWidth: 0.6,
  textStrokeColor: 'rgba(0,0,0,0.35)',
  boxBackgroundOpacity: 0.72,
  boxPaddingPx: 8,
  captionBoxBackground: 'light_frosted',
  captionBoxBorder: 'white_soft',
};

/** 与 `caption-overlay-render.buildBoxFragment` 一致的列宽与截断，用于框内实时排版 */
function visibleCaptionItemsForBox(
  items: Array<{ char: string; reading: string }>,
  style: CaptionOverlayEditorStyleState,
  scale: number,
  boxWpx: number
): Array<{ char: string; reading: string }> {
  if (boxWpx <= 0 || scale <= 0) return [];
  const pad = style.boxPaddingPx * scale;
  const textSize = style.captionTextFontSizePx * scale;
  const rubySize = style.captionRubyFontSizePx * scale;
  const colGap = 3 * scale;
  const colW = Math.max(textSize, rubySize) * 0.92;
  const maxInner = boxWpx - pad;
  const out: Array<{ char: string; reading: string }> = [];
  let cursorX = pad;
  for (const it of items) {
    if (cursorX + colW > maxInner) break;
    out.push(it);
    cursorX += colW + colGap;
  }
  return out;
}

/** 与 SVG 边框预设对应的框内描边（缩放为显示分辨率） */
function captionInnerFrameStyle(borderId: CaptionBoxBorderId, scale: number): CSSProperties {
  const sw = Math.max(1, Math.round(scale));
  switch (borderId) {
    case 'white_soft':
      return { boxShadow: `inset 0 0 0 ${sw}px rgba(255,255,255,0.45)` };
    case 'none':
      return {};
    case 'dark_thin':
      return { boxShadow: `inset 0 0 0 ${sw}px rgba(0,0,0,0.22)` };
    case 'dashed_white':
      return {
        border: `${sw}px dashed rgba(255,255,255,0.5)`,
        boxSizing: 'border-box',
      };
  }
}

type Corner = 'nw' | 'ne' | 'sw' | 'se';

interface ImageCaptionOverlayEditorProps {
  imagePath: string;
  boxes: CaptionOverlayBoxState[];
  style: CaptionOverlayEditorStyleState;
  allowEditCaptionText?: boolean;
  renderMode?: 'ruby' | 'plain';
  onBoxesChange: (boxes: CaptionOverlayBoxState[]) => void;
  onStyleChange: (style: CaptionOverlayEditorStyleState) => void;
  latestBoxesRef?: React.MutableRefObject<CaptionOverlayBoxState[]>;
}

export default function ImageCaptionOverlayEditor({
  imagePath,
  boxes,
  style,
  allowEditCaptionText = false,
  renderMode = 'ruby',
  onBoxesChange,
  onStyleChange,
  latestBoxesRef: parentLatestRef,
}: ImageCaptionOverlayEditorProps) {
  const [localBoxes, setLocalBoxes] = useState<CaptionOverlayBoxState[]>(boxes);
  const [localStyle, setLocalStyle] = useState(style);
  const [imgSize, setImgSize] = useState({ w: 1, h: 1 });
  const [imgDisplayW, setImgDisplayW] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const latestRef = useRef<CaptionOverlayBoxState[]>(boxes);
  const encodedImagePath = encodeURIComponent(imagePath);

  useEffect(() => {
    setLocalBoxes(boxes);
    latestRef.current = boxes;
    if (parentLatestRef) parentLatestRef.current = boxes;
  }, [boxes, parentLatestRef]);

  useEffect(() => {
    setLocalStyle(style);
  }, [style]);

  const pushBoxes = useCallback(
    (next: CaptionOverlayBoxState[]) => {
      latestRef.current = next;
      if (parentLatestRef) parentLatestRef.current = next;
      setLocalBoxes(next);
      onBoxesChange(next);
    },
    [onBoxesChange, parentLatestRef]
  );

  const syncImgMetrics = useCallback(() => {
    const img = imgRef.current;
    if (!img || img.naturalWidth <= 0) return;
    setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    setImgDisplayW(img.clientWidth);
  }, []);

  const handleImageLoad = useCallback(
    (_e: React.SyntheticEvent<HTMLImageElement>) => {
      syncImgMetrics();
    },
    [syncImgMetrics]
  );

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const ro = new ResizeObserver(() => syncImgMetrics());
    ro.observe(img);
    return () => ro.disconnect();
  }, [syncImgMetrics, imagePath]);

  const pushStyle = useCallback(
    (next: CaptionOverlayEditorStyleState) => {
      setLocalStyle(next);
      onStyleChange(next);
    },
    [onStyleChange]
  );

  const startMoveBox = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startBox = latestRef.current[index];
      const onMove = (me: MouseEvent) => {
        const imgEl = imgRef.current;
        if (!imgEl) return;
        const rect = imgEl.getBoundingClientRect();
        const scaleX = imgSize.w / rect.width;
        const scaleY = imgSize.h / rect.height;
        const dx = (me.clientX - startX) * scaleX;
        const dy = (me.clientY - startY) * scaleY;
        const next = [...latestRef.current];
        const b = { ...next[index] };
        b.x = Math.max(0, Math.min(imgSize.w - b.w, startBox.x + dx));
        b.y = Math.max(0, Math.min(imgSize.h - b.h, startBox.y + dy));
        next[index] = b;
        latestRef.current = next;
        setLocalBoxes(next);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        pushBoxes(latestRef.current);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [imgSize.w, imgSize.h, pushBoxes]
  );

  const startResize = useCallback(
    (index: number, corner: Corner, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const start = latestRef.current[index];
      const startX = e.clientX;
      const startY = e.clientY;
      const onMove = (me: MouseEvent) => {
        const imgEl = imgRef.current;
        if (!imgEl) return;
        const rect = imgEl.getBoundingClientRect();
        const scaleX = imgSize.w / rect.width;
        const scaleY = imgSize.h / rect.height;
        const dx = (me.clientX - startX) * scaleX;
        const dy = (me.clientY - startY) * scaleY;
        let { x, y, w, h } = start;
        if (corner === 'se') {
          w = start.w + dx;
          h = start.h + dy;
        } else if (corner === 'sw') {
          x = start.x + dx;
          w = start.w - dx;
          h = start.h + dy;
        } else if (corner === 'ne') {
          y = start.y + dy;
          w = start.w + dx;
          h = start.h - dy;
        } else if (corner === 'nw') {
          x = start.x + dx;
          y = start.y + dy;
          w = start.w - dx;
          h = start.h - dy;
        }
        w = Math.max(24, w);
        h = Math.max(24, h);
        x = Math.max(0, Math.min(x, imgSize.w - w));
        y = Math.max(0, Math.min(y, imgSize.h - h));
        if (x + w > imgSize.w) w = imgSize.w - x;
        if (y + h > imgSize.h) h = imgSize.h - y;
        const next = [...latestRef.current];
        next[index] = { ...next[index], x, y, w, h };
        latestRef.current = next;
        setLocalBoxes(next);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        pushBoxes(latestRef.current);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [imgSize.w, imgSize.h, pushBoxes]
  );

  const rubyPreview = (items: Array<{ char: string; reading: string }>) =>
    items.map((it) => (it.reading ? `${it.reading}(${it.char})` : it.char)).join(' ');

  return (
    <div className="relative w-full max-w-3xl rounded-lg border border-border bg-muted/30 overflow-visible">
      <div className="px-3 py-2 space-y-2 border-b border-border/50 text-sm">
        <div className="flex flex-wrap gap-3 items-center">
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground whitespace-nowrap">字幕字号</span>
            <input
              type="number"
              min={8}
              max={96}
              className="w-16 rounded border border-border bg-background px-2 py-0.5 text-xs"
              value={localStyle.captionTextFontSizePx}
              onChange={(e) =>
                pushStyle({ ...localStyle, captionTextFontSizePx: Number(e.target.value) || 28 })
              }
            />
          </label>
          {renderMode === 'ruby' ? (
            <label className="flex items-center gap-1">
              <span className="text-muted-foreground whitespace-nowrap">注音字号</span>
              <input
                type="number"
                min={6}
                max={48}
                className="w-16 rounded border border-border bg-background px-2 py-0.5 text-xs"
                value={localStyle.captionRubyFontSizePx}
                onChange={(e) =>
                  pushStyle({ ...localStyle, captionRubyFontSizePx: Number(e.target.value) || 14 })
                }
              />
            </label>
          ) : null}
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground whitespace-nowrap">背景颜色</span>
            <select
              className="max-w-[9.5rem] rounded border border-border bg-background px-2 py-0.5 text-xs"
              value={parseCaptionBoxBackgroundId(localStyle.captionBoxBackground)}
              onChange={(e) =>
                pushStyle({
                  ...localStyle,
                  captionBoxBackground: parseCaptionBoxBackgroundId(e.target.value),
                })
              }
            >
              {(Object.keys(CAPTION_BOX_BACKGROUND_LABELS) as CaptionBoxBackgroundId[]).map((id) => (
                <option key={id} value={id}>
                  {CAPTION_BOX_BACKGROUND_LABELS[id]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground whitespace-nowrap">边框样式</span>
            <select
              className="max-w-[9.5rem] rounded border border-border bg-background px-2 py-0.5 text-xs"
              value={parseCaptionBoxBorderId(localStyle.captionBoxBorder)}
              onChange={(e) =>
                pushStyle({
                  ...localStyle,
                  captionBoxBorder: parseCaptionBoxBorderId(e.target.value),
                })
              }
            >
              {(Object.keys(CAPTION_BOX_BORDER_LABELS) as CaptionBoxBorderId[]).map((id) => (
                <option key={id} value={id}>
                  {CAPTION_BOX_BORDER_LABELS[id]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {allowEditCaptionText && renderMode === 'ruby' && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            修改字幕后，注音（ruby）不会自动更新；严重不一致时请回到生成字幕步骤重新生成。
          </p>
        )}
      </div>
      <div className="relative">
        <div className="overflow-hidden rounded-lg">
          <img
            ref={imgRef}
            src={`local-file://${encodedImagePath}`}
            alt="字幕叠层预览"
            className="w-full h-auto block"
            onLoad={handleImageLoad}
            draggable={false}
          />
        </div>
        {imgSize.w > 1 && imgSize.h > 1 && (
          <div className="absolute inset-0 overflow-visible pointer-events-none">
            {localBoxes.map((box, index) => {
              const leftPct = (box.x / imgSize.w) * 100;
              const topPct = (box.y / imgSize.h) * 100;
              const wPct = (box.w / imgSize.w) * 100;
              const hPct = (box.h / imgSize.h) * 100;
              const scale = imgDisplayW > 0 ? imgDisplayW / imgSize.w : 1;
              const boxWpx = imgDisplayW > 0 ? (box.w / imgSize.w) * imgDisplayW : 0;
              const pad = localStyle.boxPaddingPx * scale;
              const textSizePx = localStyle.captionTextFontSizePx * scale;
              const rubySizePx = localStyle.captionRubyFontSizePx * scale;
              const colGapPx = 3 * scale;
              const rowGapPx = 4 * scale;
              const colWpx = Math.max(textSizePx, rubySizePx) * 0.92;
              const radiusPx = 10 * scale;
              const strokePx =
                localStyle.textStrokeWidth > 0 ? Math.max(0.35, localStyle.textStrokeWidth * scale) : 0;
              const strokeStyle =
                strokePx > 0
                  ? {
                      WebkitTextStroke: `${strokePx}px ${localStyle.textStrokeColor}`,
                    }
                  : {};
              const bgId = parseCaptionBoxBackgroundId(localStyle.captionBoxBackground);
              const borderId = parseCaptionBoxBorderId(localStyle.captionBoxBorder);
              const fillCss = captionBackgroundFillCss(bgId, localStyle.boxBackgroundOpacity);
              const frameStyle = captionInnerFrameStyle(borderId, scale);
              const handleCls =
                'absolute w-2.5 h-2.5 bg-primary border border-background rounded-sm pointer-events-auto z-20';
              return (
                <div
                  key={box.lineIndex}
                  className="absolute border-2 border-dashed border-primary/90 bg-transparent pointer-events-auto z-10"
                  style={{
                    left: `${leftPct}%`,
                    top: `${topPct}%`,
                    width: `${wPct}%`,
                    height: `${hPct}%`,
                  }}
                  onMouseDown={(e) => startMoveBox(index, e)}
                >
                  <div
                    className="pointer-events-none absolute inset-0 z-0 flex flex-row items-start overflow-hidden"
                    style={{
                      padding: pad,
                      gap: colGapPx,
                      borderRadius: radiusPx,
                      ...frameStyle,
                    }}
                  >
                    {fillCss !== 'transparent' ? (
                      <div
                        className="absolute inset-0 -z-10"
                        style={{
                          borderRadius: radiusPx,
                          backgroundColor: fillCss,
                        }}
                      />
                    ) : null}
                    {renderMode === 'ruby' ? (
                      visibleCaptionItemsForBox(box.items, localStyle, scale, boxWpx).map((it, j) => (
                        <div
                          key={`${box.lineIndex}-${j}-${it.char}`}
                          className="flex flex-col items-center shrink-0"
                          style={{ width: colWpx }}
                        >
                          <span
                            className="text-center"
                            style={{
                              fontSize: rubySizePx,
                              lineHeight: 1,
                              color: localStyle.captionRubyColor,
                              fontFamily: localStyle.fontFamily,
                              ...strokeStyle,
                            }}
                          >
                            {it.reading || '\u00a0'}
                          </span>
                          <span
                            className="text-center"
                            style={{
                              fontSize: textSizePx,
                              lineHeight: 1,
                              marginTop: rowGapPx,
                              color: localStyle.captionTextColor,
                              fontFamily: localStyle.fontFamily,
                              ...strokeStyle,
                            }}
                          >
                            {it.char}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span
                          className="text-center"
                          style={{
                            fontSize: textSizePx,
                            lineHeight: 1.15,
                            color: localStyle.captionTextColor,
                            fontFamily: localStyle.fontFamily,
                            ...strokeStyle,
                            wordBreak: 'break-word',
                          }}
                        >
                          {box.text}
                        </span>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label="resize-nw"
                    className={`${handleCls} -left-1 -top-1 cursor-nwse-resize`}
                    onMouseDown={(e) => startResize(index, 'nw', e)}
                  />
                  <button
                    type="button"
                    aria-label="resize-ne"
                    className={`${handleCls} -right-1 -top-1 cursor-nesw-resize`}
                    onMouseDown={(e) => startResize(index, 'ne', e)}
                  />
                  <button
                    type="button"
                    aria-label="resize-sw"
                    className={`${handleCls} -left-1 -bottom-1 cursor-nesw-resize`}
                    onMouseDown={(e) => startResize(index, 'sw', e)}
                  />
                  <button
                    type="button"
                    aria-label="resize-se"
                    className={`${handleCls} -right-1 -bottom-1 cursor-nwse-resize`}
                    onMouseDown={(e) => startResize(index, 'se', e)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="px-3 py-2 space-y-2 text-xs border-t border-border/50 max-h-48 overflow-auto">
        {localBoxes.map((box, i) => (
          <div key={box.lineIndex} className="rounded-md bg-background/60 p-2 border border-border/40">
            <div className="text-muted-foreground mb-0.5">
              第 {i + 1} 行{renderMode === 'ruby' ? ' · 只读注音预览' : ''}
            </div>
            {renderMode === 'ruby' ? (
              <div className="text-[11px] leading-relaxed break-all opacity-90">{rubyPreview(box.items)}</div>
            ) : null}
            {allowEditCaptionText ? (
              <label className="block mt-1">
                <span className="text-muted-foreground">字幕文字</span>
                <input
                  type="text"
                  className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-xs"
                  value={box.text}
                  onChange={(e) => {
                    const next = [...latestRef.current];
                    next[i] = { ...next[i], text: e.target.value };
                    latestRef.current = next;
                    setLocalBoxes(next);
                    pushBoxes(next);
                  }}
                />
              </label>
            ) : (
              <div className="mt-0.5 font-medium">{box.text}</div>
            )}
          </div>
        ))}
      </div>
      <div className="px-2 py-1 text-xs text-muted-foreground border-t border-border/50">
        框内效果与确认后导出一致。拖拽虚线框移动位置；拖动四角缩放手柄调整大小。
      </div>
    </div>
  );
}
