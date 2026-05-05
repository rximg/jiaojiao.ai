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

function toCharArrayNfc(s: string): string[] {
  // 按 JS 字符（code unit）切分即可覆盖中文与常见标点；emoji 等超出 BMP 的场景此处暂不考虑
  return Array.from(s.normalize('NFC'));
}

/**
 * 将 ruby items 对齐到脚本文字，自动补齐缺失字符（如标点），reading 置空。
 *
 * 约束：
 * - ruby items 必须是 scriptText 的子序列（允许丢字符，但不允许多字符/乱序）
 * - 若 ruby items 含有脚本中不存在的字符，则抛错（避免悄悄错位）
 */
export function normalizeCaptionRubyItemsToScriptText(
  scriptText: string,
  items: Array<{ char: string; reading: string }>
): Array<{ char: string; reading: string }> {
  const scriptChars = toCharArrayNfc(scriptText);
  const inItems = items.map((it) => ({ char: it.char.normalize('NFC'), reading: it.reading }));

  const out: Array<{ char: string; reading: string }> = [];
  let j = 0;
  for (const c of scriptChars) {
    if (j < inItems.length && inItems[j].char === c) {
      out.push({ char: c, reading: inItems[j].reading });
      j++;
    } else {
      out.push({ char: c, reading: '' });
    }
  }
  if (j !== inItems.length) {
    const rest = inItems.slice(j).map((it) => it.char).join('');
    throw new Error(`ruby items 含有脚本中不存在或乱序的字符：剩余 "${rest}"`);
  }
  return out;
}
