import { z } from 'zod';
import type { CaptionRubyLine, ScriptLine } from '#backend/domain/inference/index.js';

const captionRubyItemSchema = z.object({
  char: z.string(),
  reading: z.string(),
});

const captionRubyLineSchema = z.object({
  index: z.number().int().nonnegative(),
  items: z.array(captionRubyItemSchema),
});

const payloadSchema = z.object({
  lines: z.array(captionRubyLineSchema),
});

export function parseCaptionRubyPayload(raw: string): { lines: CaptionRubyLine[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('captionRubyLines JSON 无法解析');
  }
  return payloadSchema.parse(parsed) as { lines: CaptionRubyLine[] };
}

export function assertCaptionRubyMatchesScriptLines(
  scriptLines: ScriptLine[],
  rubyLines: CaptionRubyLine[]
): void {
  if (scriptLines.length !== rubyLines.length) {
    throw new Error(
      `字幕行数 ${scriptLines.length} 与 captionRubyLines 行数 ${rubyLines.length} 不一致`
    );
  }
  for (let i = 0; i < scriptLines.length; i++) {
    const scriptText = scriptLines[i].text.normalize('NFC');
    const joined = rubyLines[i].items.map((it) => it.char).join('').normalize('NFC');
    if (joined !== scriptText) {
      throw new Error(
        `第 ${i} 行字幕与 ruby items 拼接不一致：期望 "${scriptText}"，得到 "${joined}"`
      );
    }
    if (rubyLines[i].index !== i) {
      throw new Error(`captionRubyLines[${i}].index 应为 ${i}，实际为 ${rubyLines[i].index}`);
    }
  }
}
