import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Bot } from 'lucide-react';
import type { HitlBlockRecord } from '@/types/types';
import { hitlResolvedView } from '@/lib/hitl-block';
import DocumentBlock from './DocumentBlock';
import MarkdownDocumentBlock from './MarkdownDocumentBlock';
import ImageBlock from './ImageBlock';
import EditableDocumentBlock from './EditableDocumentBlock';
import ImageWithBoundingBoxes from './ImageWithBoundingBoxes';
import {
  parseCaptionBoxBackgroundId,
  parseCaptionBoxBorderId,
} from '#backend/services/caption-overlay-style-shared.js';
import ImageCaptionOverlayEditor, {
  DEFAULT_CAPTION_OVERLAY_EDITOR_STYLE,
  type CaptionOverlayBoxState,
  type CaptionOverlayEditorStyleState,
} from './ImageCaptionOverlayEditor';

export interface PendingHitlRequest {
  requestId: string;
  actionType: string;
  payload: Record<string, unknown>;
}

const ACTION_TITLE: Record<string, string> = {  'story.plan_review': '确认绘本故事策划稿？',  'ai.batch_tool_call': '批量执行工具？',  'ai.text2image': '生成图像？',
  'ai.text2speech': '合成语音？',
  'ai.vl_script': '以图生剧本？',
  'ai.vl_caption_regions': '确认字幕区布局（VL）？',
  'ai.image_caption_overlay': '确认字幕叠层与注音？',
  'ai.image_label_order': '标注图片序号？',
  'artifacts.delete': '删除以下产物？',
};

interface HitlConfirmBlockProps {
  /** 待确认请求或已结束记录（含 approved） */
  request: PendingHitlRequest | HitlBlockRecord;
  /** 会话 ID，用于读取 promptFile 内容（仅 pending 时需要） */
  sessionId?: string | null;
  /** 主进程是否仍在等待本次 respond（false = Stale，仅消息落盘） */
  isLive?: boolean;
  /** pending 时 debounce 持久化草稿 */
  onDraftEditsChange?: (draftEdits: Record<string, unknown>) => void;
  onContinue?: (editedPayload?: Record<string, unknown>) => void;
  onCancel?: (cancelReason?: string) => void;
  onAddAllowlist?: (actionType: string) => void;
}

function asHitlRecord(r: PendingHitlRequest | HitlBlockRecord): HitlBlockRecord | undefined {
  if ('status' in r && r.status) return r as HitlBlockRecord;
  if ('approved' in r && typeof (r as HitlBlockRecord).approved === 'boolean') return r as HitlBlockRecord;
  return undefined;
}

/** 将 "1. xxx\n2. yyy" 解析回 string[] */
function parseNumberedLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*\d+\.\s*/, '').trim())
    .filter(Boolean);
}

const PLAN_REVIEW_PREVIEW_MAX_LINES = 5;
const PLAN_REVIEW_PREVIEW_MAX_CHARS = 280;

/** 策划稿收起时的摘要：前 N 行且不超过 N 字，用于判断是否需要折叠开关 */
function planReviewCollapsedExcerpt(full: string): { excerpt: string; needsToggle: boolean } {
  const t = full ?? '';
  if (!t) return { excerpt: '', needsToggle: false };
  const lines = t.split('\n');
  const moreThanLines = lines.length > PLAN_REVIEW_PREVIEW_MAX_LINES;
  let excerpt = lines.slice(0, PLAN_REVIEW_PREVIEW_MAX_LINES).join('\n');
  let needsToggle = moreThanLines;
  if (excerpt.length > PLAN_REVIEW_PREVIEW_MAX_CHARS) {
    excerpt = `${excerpt.slice(0, PLAN_REVIEW_PREVIEW_MAX_CHARS)}…`;
    needsToggle = true;
  }
  if (!needsToggle && excerpt.length < t.length) {
    needsToggle = true;
  }
  return { excerpt, needsToggle };
}

export default function HitlConfirmBlock({
  request,
  sessionId,
  isLive = true,
  onDraftEditsChange,
  onContinue,
  onCancel,
  onAddAllowlist,
}: HitlConfirmBlockProps) {
  const resolved = useMemo(() => hitlResolvedView(asHitlRecord(request)), [request]);
  const title = ACTION_TITLE[request.actionType] ?? '确认操作';
  const payload = request.payload;

  // 可编辑内容状态（仅 pending 时使用）
  const [editablePrompt, setEditablePrompt] = useState<string>('');
  const [editableTexts, setEditableTexts] = useState<string>('');
  const [promptFileLoading, setPromptFileLoading] = useState(false);
  const [promptLoadedFromFile, setPromptLoadedFromFile] = useState(false);
  const [labelAnnotations, setLabelAnnotations] = useState<Array<{ number: number; x: number; y: number }>>([]);
  const labelAnnotationsRef = useRef<Array<{ number: number; x: number; y: number }>>([]);
  const [editableVlUserPrompt, setEditableVlUserPrompt] = useState('');
  const [editableVlCaptionUserPrompt, setEditableVlCaptionUserPrompt] = useState('');
  const [captionOverlayBoxes, setCaptionOverlayBoxes] = useState<CaptionOverlayBoxState[]>([]);
  const [captionOverlayStyle, setCaptionOverlayStyle] = useState<CaptionOverlayEditorStyleState>(
    DEFAULT_CAPTION_OVERLAY_EDITOR_STYLE
  );
  const captionOverlayBoxesRef = useRef<CaptionOverlayBoxState[]>([]);
  const [editableMarkdownContent, setEditableMarkdownContent] = useState('');
  /** story.plan_review：默认展开；仅当正文超过摘要阈值时可收起 */
  const [planReviewExpanded, setPlanReviewExpanded] = useState(true);

  useEffect(() => {
    if (request.actionType !== 'story.plan_review') return;
    setPlanReviewExpanded(true);
  }, [request.actionType, request.requestId]);

  /** 从持久化 draftEdits 恢复编辑态（换 session / 刷新后） */
  useEffect(() => {
    if (resolved) return;
    const rec = asHitlRecord(request);
    const d = rec?.draftEdits;
    if (!d || typeof d !== 'object') return;
    switch (request.actionType) {
      case 'ai.text2image':
        if (typeof d.prompt === 'string') setEditablePrompt(d.prompt);
        break;
      case 'ai.text2speech':
        if (Array.isArray(d.texts)) {
          setEditableTexts(
            d.texts.map((t: unknown, i: number) => `${i + 1}. ${String(t)}`).join('\n') || ''
          );
        }
        break;
      case 'ai.vl_script':
        if (typeof d.userPrompt === 'string') setEditableVlUserPrompt(d.userPrompt);
        break;
      case 'ai.vl_caption_regions':
        if (typeof d.userPrompt === 'string') setEditableVlCaptionUserPrompt(d.userPrompt);
        break;
      case 'ai.image_caption_overlay':
        if (Array.isArray(d.captionBoxes)) {
          setCaptionOverlayBoxes(d.captionBoxes as CaptionOverlayBoxState[]);
          captionOverlayBoxesRef.current = d.captionBoxes as CaptionOverlayBoxState[];
        }
        if (d.captionStyle && typeof d.captionStyle === 'object') {
          const st = d.captionStyle as Partial<CaptionOverlayEditorStyleState>;
          setCaptionOverlayStyle({
            ...DEFAULT_CAPTION_OVERLAY_EDITOR_STYLE,
            ...st,
            captionBoxBackground: parseCaptionBoxBackgroundId(
              (st as { captionBoxBackground?: unknown }).captionBoxBackground
            ),
            captionBoxBorder: parseCaptionBoxBorderId((st as { captionBoxBorder?: unknown }).captionBoxBorder),
          });
        }
        break;
      case 'story.plan_review':
        if (typeof d.markdownContent === 'string') setEditableMarkdownContent(d.markdownContent);
        break;
      case 'ai.image_label_order':
        if (Array.isArray(d.annotations)) {
          setLabelAnnotations(d.annotations as Array<{ number: number; x: number; y: number }>);
          labelAnnotationsRef.current = d.annotations as Array<{ number: number; x: number; y: number }>;
        }
        break;
      default:
        break;
    }
    // 仅在新的 HITL 条或从磁盘载入时依赖 requestId / actionType
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.requestId, request.actionType, resolved]);

  // 加载 promptFile 内容
  useEffect(() => {
    if (resolved || request.actionType !== 'ai.text2image') return;
    const prompt = typeof payload.prompt === 'string' ? payload.prompt : null;
    const promptFile = typeof payload.promptFile === 'string' ? payload.promptFile : null;
    if (prompt) {
      setEditablePrompt(prompt);
      setPromptLoadedFromFile(false);
      return;
    }
    if (promptFile && sessionId && typeof window.electronAPI?.fs?.readFile === 'function') {
      setPromptFileLoading(true);
      setPromptLoadedFromFile(false);
      window.electronAPI.fs
        .readFile(sessionId, promptFile)
        .then((res: { content?: string }) => {
          setEditablePrompt(res?.content ?? '');
          setPromptLoadedFromFile(true);
        })
        .catch(() => {
          setEditablePrompt(`将使用文件：${promptFile}`);
          setPromptLoadedFromFile(false);
        })
        .finally(() => setPromptFileLoading(false));
    } else if (promptFile) {
      setEditablePrompt(`将使用文件：${promptFile}`);
      setPromptLoadedFromFile(false);
    }
  }, [resolved, request.actionType, payload.prompt, payload.promptFile, sessionId]);

  // 初始化 texts 编辑内容
  useEffect(() => {
    if (resolved || request.actionType !== 'ai.text2speech') return;
    const texts = Array.isArray(payload.texts) ? payload.texts : [];
    setEditableTexts(texts.map((t: unknown, i: number) => `${i + 1}. ${String(t)}`).join('\n') || '');
  }, [resolved, request.actionType, payload.texts]);

  // 初始化图片序号标注
  useEffect(() => {
    if (resolved || request.actionType !== 'ai.image_label_order') return;
    const ann = Array.isArray(payload.annotations) ? payload.annotations : [];
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    const numbers = Array.isArray(payload.numbers) ? payload.numbers : [];
    let next: Array<{ number: number; x: number; y: number }> = [];
    if (ann.length > 0) {
      next = ann.map((a: unknown) => (typeof a === 'object' && a && 'number' in a && 'x' in a && 'y' in a ? { number: Number((a as { number: unknown }).number) || 1, x: Number((a as { x: unknown }).x) || 0, y: Number((a as { y: unknown }).y) || 0 } : { number: 1, x: 0, y: 0 }));
    } else if (lines.length > 0) {
      next = lines.map((l: unknown, i: number) => {
        const obj = typeof l === 'object' && l && 'x' in l && 'y' in l ? (l as { x: number; y: number }) : { x: 0, y: 0 };
        const num = typeof numbers[i] === 'number' ? numbers[i] : i + 1;
        return { number: num, x: Number(obj.x) || 0, y: Number(obj.y) || 0 };
      });
    }
    if (next.length > 0) {
      setLabelAnnotations(next);
      labelAnnotationsRef.current = next;
    }
  }, [resolved, request.actionType, payload.annotations, payload.lines, payload.numbers]);

  // 初始化 vl_script 用户补充/修改
  useEffect(() => {
    if (resolved || request.actionType !== 'ai.vl_script') return;
    const up = typeof payload.userPrompt === 'string' ? payload.userPrompt : '';
    setEditableVlUserPrompt(up);
  }, [resolved, request.actionType, payload.userPrompt]);

  useEffect(() => {
    if (resolved || request.actionType !== 'ai.vl_caption_regions') return;
    const up = typeof payload.userPrompt === 'string' ? payload.userPrompt : '';
    setEditableVlCaptionUserPrompt(up);
  }, [resolved, request.actionType, payload.userPrompt]);

  useEffect(() => {
    if (resolved || request.actionType !== 'ai.image_caption_overlay') return;
    const boxes = Array.isArray(payload.captionBoxes) ? (payload.captionBoxes as CaptionOverlayBoxState[]) : [];
    setCaptionOverlayBoxes(boxes);
    captionOverlayBoxesRef.current = boxes;
    const st =
      payload.captionStyle && typeof payload.captionStyle === 'object'
        ? (payload.captionStyle as Partial<CaptionOverlayEditorStyleState>)
        : {};
    setCaptionOverlayStyle({
      ...DEFAULT_CAPTION_OVERLAY_EDITOR_STYLE,
      ...st,
      captionBoxBackground: parseCaptionBoxBackgroundId(
        (st as { captionBoxBackground?: unknown }).captionBoxBackground
      ),
      captionBoxBorder: parseCaptionBoxBorderId((st as { captionBoxBorder?: unknown }).captionBoxBorder),
    });
  }, [resolved, request.actionType, payload.captionBoxes, payload.captionStyle]);

  useEffect(() => {
    if (resolved || request.actionType !== 'story.plan_review') return;
    const markdownContent = typeof payload.markdownContent === 'string' ? payload.markdownContent : '';
    setEditableMarkdownContent(markdownContent);
  }, [resolved, request.actionType, payload.markdownContent]);

  const computeEditedPayload = useCallback((): Record<string, unknown> | undefined => {
    if (resolved) return undefined;
    if (request.actionType === 'ai.text2image') {
      const trimmed = editablePrompt.trim();
      if (trimmed && (promptLoadedFromFile || !trimmed.startsWith('将使用文件：'))) return { prompt: trimmed };
      return undefined;
    }
    if (request.actionType === 'ai.text2speech') {
      return { texts: parseNumberedLines(editableTexts) };
    }
    if (request.actionType === 'ai.image_label_order') {
      const latest = labelAnnotationsRef.current.length > 0 ? labelAnnotationsRef.current : labelAnnotations;
      return latest.length > 0 ? { annotations: latest } : undefined;
    }
    if (request.actionType === 'ai.vl_script') {
      const trimmed = editableVlUserPrompt.trim();
      return trimmed ? { userPrompt: trimmed } : undefined;
    }
    if (request.actionType === 'ai.vl_caption_regions') {
      const trimmed = editableVlCaptionUserPrompt.trim();
      return trimmed ? { userPrompt: trimmed } : undefined;
    }
    if (request.actionType === 'ai.image_caption_overlay') {
      const latest =
        captionOverlayBoxesRef.current.length > 0 ? captionOverlayBoxesRef.current : captionOverlayBoxes;
      return {
        captionBoxes: latest,
        captionStyle: captionOverlayStyle,
      };
    }
    if (request.actionType === 'story.plan_review') {
      const trimmed = editableMarkdownContent.trim();
      return trimmed ? { markdownContent: trimmed } : undefined;
    }
    return undefined;
  }, [
    resolved,
    request.actionType,
    editablePrompt,
    editableTexts,
    promptLoadedFromFile,
    labelAnnotations,
    editableVlUserPrompt,
    editableVlCaptionUserPrompt,
    captionOverlayBoxes,
    captionOverlayStyle,
    editableMarkdownContent,
  ]);

  const handleContinue = useCallback(() => {
    if (!onContinue) return;
    if (request.actionType === 'ai.text2image' && !resolved) {
      const edited = computeEditedPayload();
      if (edited) onContinue(edited);
      else onContinue();
      return;
    }
    if (request.actionType === 'ai.text2speech' && !resolved) {
      onContinue({ texts: parseNumberedLines(editableTexts) });
      return;
    }
    const edited = computeEditedPayload();
    if (edited && Object.keys(edited).length > 0) onContinue(edited);
    else onContinue();
  }, [onContinue, request.actionType, resolved, computeEditedPayload, editableTexts]);

  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (resolved || !onDraftEditsChange) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      draftTimerRef.current = null;
      if (request.actionType === 'ai.text2speech' && !resolved) {
        onDraftEditsChange({ texts: parseNumberedLines(editableTexts) });
        return;
      }
      const d = computeEditedPayload();
      onDraftEditsChange(d && Object.keys(d).length > 0 ? d : {});
    }, 450);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [resolved, onDraftEditsChange, computeEditedPayload, request.actionType, editableTexts]);

  const renderPayload = () => {
    // ── 批量模式：统一展示子任务列表 ──
    if (payload._batchMode) {
      const total = payload._batchTotal as number;
      const items = Array.isArray(payload._batchItems) ? (payload._batchItems as string[]) : [];
      const commonEntries = Object.entries(payload).filter(
        ([k]) => !k.startsWith('_')
      );
      return (
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">
            共 <span className="font-semibold text-foreground">{total}</span> 项
          </div>
          <ul className="text-sm space-y-1 max-h-40 overflow-auto">
            {items.slice(0, 6).map((item, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <span className="text-muted-foreground text-xs">#{i + 1}</span>
                <span>{item}</span>
              </li>
            ))}
            {items.length > 6 && (
              <li className="text-muted-foreground text-xs">… 等 {items.length - 6} 项</li>
            )}
          </ul>
          {commonEntries.length > 0 && (
            <div className="text-xs text-muted-foreground space-y-0.5">
              {commonEntries.map(([k, v]) => (
                <div key={k}>
                  <span className="font-medium">{k}</span>：{String(v)}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (request.actionType === 'ai.text2image') {
      const prompt = typeof payload.prompt === 'string' ? payload.prompt : null;
      const promptFile = typeof payload.promptFile === 'string' ? payload.promptFile : null;
      if (resolved) {
        if (prompt) return <DocumentBlock pathOrContent={prompt} title="提示词" />;
        if (promptFile) return <DocumentBlock pathOrContent={`将使用文件：${promptFile}`} title="提示词文件" />;
        return <div className="text-sm opacity-80">无提示词</div>;
      }
      if (promptFileLoading) return <div className="text-sm opacity-80">加载中...</div>;
      return (
        <EditableDocumentBlock
          value={editablePrompt}
          onChange={setEditablePrompt}
          title="提示词"
          placeholder="输入或编辑提示词..."
          minRows={8}
        />
      );
    }
    if (request.actionType === 'ai.text2speech') {
      const texts = Array.isArray(payload.texts) ? payload.texts : [];
      const content = texts.map((t: unknown, i: number) => `${i + 1}. ${String(t)}`).join('\n') || '无台词';
      if (resolved) {
        return <DocumentBlock pathOrContent={content} title="台词" />;
      }
      return (
        <EditableDocumentBlock
          value={editableTexts}
          onChange={setEditableTexts}
          title="台词"
          placeholder="每行一段台词，可带序号（如 1. xxx）"
          minRows={10}
        />
      );
    }
    if (request.actionType === 'ai.vl_script') {
      const imagePath = typeof payload.imagePath === 'string' ? payload.imagePath : '';
      if (resolved) {
        const up = typeof payload.userPrompt === 'string' ? payload.userPrompt : null;
        return (
          <div className="space-y-2">
            {imagePath ? <ImageBlock path={imagePath} sessionId={sessionId} /> : <div className="text-sm opacity-80">无图片路径</div>}
            {up ? <DocumentBlock pathOrContent={up} title="用户补充/修改" /> : null}
          </div>
        );
      }
      return (
        <div className="space-y-2">
          {imagePath ? <ImageBlock path={imagePath} sessionId={sessionId} /> : <div className="text-sm opacity-80">无图片路径</div>}
          <EditableDocumentBlock
            value={editableVlUserPrompt}
            onChange={setEditableVlUserPrompt}
            title="用户补充或修改要求"
            placeholder="可输入对以图生剧本的补充或修改（如：更简短、加入旁白、改成儿童语气等），将与系统提示词一起传给 VL..."
            minRows={4}
          />
        </div>
      );
    }
    if (request.actionType === 'ai.vl_caption_regions') {
      const imagePath = typeof payload.imagePath === 'string' ? payload.imagePath : '';
      const ctx = Array.isArray(payload.contextLines) ? payload.contextLines : [];
      const ctxText = ctx.map((t: unknown, i: number) => `${i + 1}. ${String(t)}`).join('\n') || '（无）';
      if (resolved) {
        const up = typeof payload.userPrompt === 'string' ? payload.userPrompt : null;
        return (
          <div className="space-y-2">
            {imagePath ? <ImageBlock path={imagePath} sessionId={sessionId} /> : <div className="text-sm opacity-80">无图片路径</div>}
            <DocumentBlock pathOrContent={ctxText} title="字幕文案（上下文）" />
            {up ? <DocumentBlock pathOrContent={up} title="用户补充/修改" /> : null}
          </div>
        );
      }
      return (
        <div className="space-y-2">
          {imagePath ? <ImageBlock path={imagePath} sessionId={sessionId} /> : <div className="text-sm opacity-80">无图片路径</div>}
          <DocumentBlock pathOrContent={ctxText} title="字幕文案（将传给 VL，须与叠层使用的字幕一致）" />
          <EditableDocumentBlock
            value={editableVlCaptionUserPrompt}
            onChange={setEditableVlCaptionUserPrompt}
            title="用户补充或修改要求"
            placeholder="可描述希望字幕区出现在画面中的大致位置、避让主体等，将与系统提示词一起传给 VL..."
            minRows={4}
          />
        </div>
      );
    }
    if (request.actionType === 'ai.image_caption_overlay') {
      const imagePath = typeof payload.imagePath === 'string' ? payload.imagePath : '';
      const allowEdit = payload.allowEditCaptionText === true;
      if (resolved) {
        return imagePath ? (
          <ImageBlock path={imagePath} sessionId={sessionId} />
        ) : (
          <div className="text-sm opacity-80">无图片路径</div>
        );
      }
      if (!imagePath || captionOverlayBoxes.length === 0) {
        return <div className="text-sm opacity-80">加载中或无字幕框数据...</div>;
      }
      return (
        <ImageCaptionOverlayEditor
          imagePath={imagePath}
          boxes={captionOverlayBoxes}
          style={captionOverlayStyle}
          allowEditCaptionText={allowEdit}
          onBoxesChange={(b) => {
            setCaptionOverlayBoxes(b);
            captionOverlayBoxesRef.current = b;
          }}
          onStyleChange={setCaptionOverlayStyle}
          latestBoxesRef={captionOverlayBoxesRef}
        />
      );
    }
    if (request.actionType === 'ai.image_label_order') {
      const imagePath = typeof payload.imagePath === 'string' ? payload.imagePath : '';
      if (resolved) {
        const ann = Array.isArray(payload.annotations) ? payload.annotations : [];
        if (imagePath && ann.length > 0) {
          return <ImageBlock path={imagePath} sessionId={sessionId} />;
        }
        return imagePath ? <ImageBlock path={imagePath} sessionId={sessionId} /> : <div className="text-sm opacity-80">无图片路径</div>;
      }
      if (imagePath && labelAnnotations.length > 0) {
        return (
          <ImageWithBoundingBoxes
            imagePath={imagePath}
            annotations={labelAnnotations}
            imageWidth={typeof payload.imageWidth === 'number' ? payload.imageWidth : undefined}
            imageHeight={typeof payload.imageHeight === 'number' ? payload.imageHeight : undefined}
            onChange={(annotations) => setLabelAnnotations(annotations)}
            latestRef={labelAnnotationsRef}
          />
        );
      }
      return <div className="text-sm opacity-80">加载中或无标注数据...</div>;
    }
    if (request.actionType === 'artifacts.delete') {
      const paths = Array.isArray(payload.paths) ? payload.paths : [];
      const content = paths.length > 0 ? paths.map((p: unknown) => `• ${String(p)}`).join('\n') : '无待删除文件';
      return <DocumentBlock pathOrContent={content} title="待删除文件" />;
    }
    if (request.actionType === 'story.plan_review') {
      const markdownContent = typeof payload.markdownContent === 'string' ? payload.markdownContent : '';
      const documentTitle = typeof payload.title === 'string' ? payload.title : '绘本故事策划稿';
      const allowEdit = payload.allowEdit === true;
      const sourceText = resolved ? markdownContent : allowEdit ? editableMarkdownContent : markdownContent;
      const { excerpt, needsToggle } = planReviewCollapsedExcerpt(sourceText);
      const showCollapsed = needsToggle && !planReviewExpanded;

      const headerRow = (opts: { mode: 'collapsed' | 'expanded' }) => (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-border/50">
          <span className="text-sm font-medium text-foreground min-w-0">{documentTitle}</span>
          {needsToggle &&
            (opts.mode === 'collapsed' ? (
              <button
                type="button"
                onClick={() => setPlanReviewExpanded(true)}
                className="text-sm text-primary hover:underline shrink-0"
              >
                展开全文
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setPlanReviewExpanded(false)}
                className="text-sm text-primary hover:underline shrink-0"
              >
                收起
              </button>
            ))}
        </div>
      );

      if (showCollapsed) {
        return (
          <div className="rounded-lg border border-border bg-muted/30 overflow-hidden w-full min-w-0">
            {headerRow({ mode: 'collapsed' })}
            <pre className="text-xs whitespace-pre-wrap break-words px-3 py-3 text-muted-foreground font-sans max-w-none">
              {excerpt}
            </pre>
            {!resolved && allowEdit && (
              <p className="text-xs text-muted-foreground px-3 pb-3">收起状态下仅显示摘要，点击「展开全文」后可编辑。</p>
            )}
          </div>
        );
      }

      return (
        <div className="rounded-lg border border-border bg-muted/30 overflow-hidden w-full min-w-0">
          {headerRow({ mode: 'expanded' })}
          {resolved ? (
            <MarkdownDocumentBlock content={markdownContent} hideTitle />
          ) : allowEdit ? (
            <EditableDocumentBlock
              value={editableMarkdownContent}
              onChange={setEditableMarkdownContent}
              title={documentTitle}
              placeholder="输入或编辑绘本故事策划稿 Markdown..."
              minRows={16}
              hideTitleRow
            />
          ) : (
            <MarkdownDocumentBlock content={markdownContent} hideTitle />
          )}
        </div>
      );
    }
    return (
      <pre className="text-xs whitespace-pre-wrap break-words max-h-32 overflow-auto rounded bg-background/80 p-2 border border-border/50">
        {JSON.stringify(payload, null, 2)}
      </pre>
    );
  };

  return (
    <div className="flex gap-4 justify-start w-full">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
        <Bot className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0 w-full rounded-2xl px-4 py-3 shadow-sm bg-muted text-muted-foreground">
        <div className="font-medium text-foreground mb-2">{title}</div>
        {!resolved && (
          <div className="mb-3 space-y-2 pb-3 border-b border-border/50">
            {!isLive && (
              <p className="text-xs text-amber-800 dark:text-amber-200 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
                离线待确认：无法自动连回运行中的任务。请在下方输入框发送「继续上一步确认」，由会话 checkpoint
                重新进入该步骤。
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleContinue}
                className="px-3 py-1.5 text-sm rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                {typeof payload.confirmText === 'string' ? payload.confirmText : payload._batchMode ? '全部执行' : '继续执行'}
              </button>
              <button
                type="button"
                onClick={() => onCancel?.()}
                className="px-3 py-1.5 text-sm rounded-xl border border-border text-muted-foreground hover:bg-muted/80 transition-colors"
              >
                {typeof payload.cancelText === 'string' ? payload.cancelText : '暂不执行本次'}
              </button>
              <button
                type="button"
                onClick={() => onAddAllowlist?.(request.actionType)}
                className="px-3 py-1.5 text-sm rounded-xl border border-border hover:bg-muted/80 transition-colors"
                title="仅影响后续同类操作，本次仍需确认"
              >
                加入自动通过列表
              </button>
            </div>
          </div>
        )}
        {resolved && (
          <div className="mb-3 text-sm opacity-80 pb-3 border-b border-border/50">
            {resolved.approved ? '已继续' : '未继续'}
          </div>
        )}
        <div className="space-y-2">{renderPayload()}</div>
      </div>
    </div>
  );
}
