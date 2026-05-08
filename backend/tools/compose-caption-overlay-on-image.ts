/**
 * compose_caption_overlay_on_image：合并 VL 字幕框与 Skill 产出的 captionRubyLines，经 HITL 后 Sharp 合成
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import path from 'path';
import sharp from 'sharp';
import { getWorkspaceFilesystem } from '../services/fs.js';
import {
  defaultNormalizedCaptionRect,
  normalizedRectToPixelRect,
} from '../services/caption-region-geometry.js';
import {
  assertCaptionRubyMatchesScriptLines,
  normalizeCaptionRubyItemsToScriptText,
  parseCaptionRubyPayload,
} from '../services/caption-ruby-payload.js';
import {
  composeCaptionOverlayImage,
  DEFAULT_CAPTION_OVERLAY_STYLE,
  type CaptionOverlayStyleParams,
} from '../services/caption-overlay-render.js';
import type { CaptionRubyLine, ScriptLine } from '#backend/domain/inference/index.js';
import type { ToolConfig, ToolContext } from './registry.js';
import { registerTool } from './registry.js';

const scriptLineSchema = z.object({
  text: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number().optional(),
  h: z.number().optional(),
});

const rubyLineSchema = z.object({
  index: z.number().int().nonnegative(),
  items: z.array(z.object({ char: z.string(), reading: z.string() })),
});

function coerceCaptionRubyLines(raw: unknown): CaptionRubyLine[] {
  if (raw == null) {
    throw new Error('renderMode=ruby 时 captionRubyLines 为必填');
  }
  const arr: CaptionRubyLine[] =
    typeof raw === 'string'
      ? parseCaptionRubyPayload(raw).lines
      : (z.array(rubyLineSchema).parse(raw) as CaptionRubyLine[]);
  const sorted = [...arr].sort((a, b) => a.index - b.index);
  return sorted.map((line, i) => ({ ...line, index: i }));
}

function resolveImageAbsoluteForTool(
  imagePath: string,
  sessionId: string,
  workspaceRoot: string
): string {
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

function create(_config: ToolConfig, context: ToolContext) {
  return tool(
    async (input: {
      imagePath: string;
      lines: ScriptLine[];
      captionRubyLines?: unknown;
      renderMode?: 'ruby' | 'plain';
      sessionId?: string;
      allowEditCaptionText?: boolean;
    }) => {
      const sessionId = input.sessionId || context.getDefaultSessionId();
      const lines = z.array(scriptLineSchema).parse(input.lines) as ScriptLine[];
      const renderMode: 'ruby' | 'plain' = input.renderMode ?? 'ruby';
      const rubyLines =
        renderMode === 'ruby'
          ? coerceCaptionRubyLines(input.captionRubyLines).map((line, i) => ({
              ...line,
              items: normalizeCaptionRubyItemsToScriptText(lines[i]?.text ?? '', line.items),
            }))
          : undefined;
      if (renderMode === 'ruby') {
        assertCaptionRubyMatchesScriptLines(lines, rubyLines ?? []);
      }

      const workspaceFs = getWorkspaceFilesystem({});
      const workspaceRoot = workspaceFs.root;
      const absPath = resolveImageAbsoluteForTool(input.imagePath, sessionId, workspaceRoot);
      const meta = await sharp(absPath).metadata();
      const iw = meta.width ?? 0;
      const ih = meta.height ?? 0;
      if (iw <= 0 || ih <= 0) {
        throw new Error('无法读取图片尺寸');
      }

      const captionBoxes = lines.map((line, i) => {
        const def = defaultNormalizedCaptionRect(i, lines.length);
        const norm = {
          x: Number.isFinite(line.x) ? line.x : def.x,
          y: Number.isFinite(line.y) ? line.y : def.y,
          w: line.w ?? def.w,
          h: line.h ?? def.h,
        };
        const pix = normalizedRectToPixelRect(norm, iw, ih);
        return {
          lineIndex: i,
          text: line.text,
          x: pix.x,
          y: pix.y,
          w: pix.w,
          h: pix.h,
          items: renderMode === 'ruby' ? (rubyLines?.[i]?.items ?? []) : [],
        };
      });

      const hitlPayload: Record<string, unknown> = {
        imagePath: input.imagePath,
        sessionId,
        imageWidth: iw,
        imageHeight: ih,
        captionBoxes,
        captionStyle: { ...DEFAULT_CAPTION_OVERLAY_STYLE },
        allowEditCaptionText: input.allowEditCaptionText === true,
        renderMode,
      };

      const merged = await context.requestApprovalViaHITL('ai.image_caption_overlay', hitlPayload);

      const mergedStyle = {
        ...DEFAULT_CAPTION_OVERLAY_STYLE,
        ...(merged.captionStyle as Partial<CaptionOverlayStyleParams>),
      };
      const mergedBoxes = (Array.isArray(merged.captionBoxes) ? merged.captionBoxes : captionBoxes) as Array<{
        lineIndex: number;
        text: string;
        x: number;
        y: number;
        w: number;
        h: number;
        items?: Array<{ char: string; reading: string }>;
      }>;

      const boxesForRender = mergedBoxes.map((b) => ({
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        text: b.text,
        items: Array.isArray(b.items) ? b.items : [],
      }));

      return composeCaptionOverlayImage({
        imagePath: input.imagePath,
        sessionId,
        boxes: boxesForRender,
        style: mergedStyle,
      });
    },
    {
      name: 'compose_caption_overlay_on_image',
      description:
        '在插画上叠加字幕与 ruby（注音行）：传入 suggest_caption_regions 返回的 lines 与「生成字幕」步骤产出的 captionRubyLines，经人工确认几何与字号后输出成品图路径',
      schema: z.object({
        imagePath: z.string().describe('待叠字的插画路径'),
        lines: z
          .array(scriptLineSchema)
          .describe('VL 字幕区结果（含归一化 x,y,w,h），通常来自 suggest_caption_regions'),
        captionRubyLines: z
          .union([z.string(), z.array(rubyLineSchema)])
          .optional()
          .describe(
            '结构化 ruby JSON 字符串，或 lines 数组（index + items[{char,reading}]）。renderMode=ruby 时必填；renderMode=plain 时可省略'
          ),
        renderMode: z
          .enum(['ruby', 'plain'])
          .optional()
          .describe('渲染模式：ruby=字幕+注音；plain=仅字幕（不需要 captionRubyLines）'),
        sessionId: z.string().optional(),
        allowEditCaptionText: z
          .boolean()
          .optional()
          .describe('是否在 HITL 中允许改字幕汉字（改字后注音不会自动更新）'),
      }),
    }
  );
}

registerTool('compose_caption_overlay_on_image', create);
