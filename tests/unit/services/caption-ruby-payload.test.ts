import { describe, it, expect } from 'vitest';
import {
  parseCaptionRubyPayload,
  assertCaptionRubyMatchesScriptLines,
  normalizeCaptionRubyItemsToScriptText,
} from '../../../backend/services/caption-ruby-payload.js';
import type { ScriptLine } from '#backend/domain/inference/index.js';

describe('caption-ruby-payload', () => {
  it('parseCaptionRubyPayload accepts valid JSON', () => {
    const raw = JSON.stringify({
      lines: [{ index: 0, items: [{ char: '宝', reading: 'bǎo' }, { char: '。', reading: '' }] }],
    });
    const out = parseCaptionRubyPayload(raw);
    expect(out.lines[0].items[1].reading).toBe('');
  });

  it('assertCaptionRubyMatchesScriptLines passes when chars join to text', () => {
    const script: ScriptLine[] = [{ text: '宝。', x: 0, y: 0 }];
    const pl = {
      lines: [{ index: 0, items: [{ char: '宝', reading: 'bǎo' }, { char: '。', reading: '' }] }],
    };
    expect(() => assertCaptionRubyMatchesScriptLines(script, pl.lines)).not.toThrow();
  });

  it('assertCaptionRubyMatchesScriptLines throws on mismatch', () => {
    const script: ScriptLine[] = [{ text: '你好', x: 0, y: 0 }];
    const pl = { lines: [{ index: 0, items: [{ char: '你', reading: 'nǐ' }] }] };
    expect(() => assertCaptionRubyMatchesScriptLines(script, pl.lines)).toThrow();
  });

  it('normalizeCaptionRubyItemsToScriptText fills missing punctuation with empty reading', () => {
    const scriptText = '一去二三里，';
    const items = [
      { char: '一', reading: 'yī' },
      { char: '去', reading: 'qù' },
      { char: '二', reading: 'èr' },
      { char: '三', reading: 'sān' },
      { char: '里', reading: 'lǐ' },
    ];
    const out = normalizeCaptionRubyItemsToScriptText(scriptText, items);
    expect(out.map((x) => x.char).join('')).toBe(scriptText);
    expect(out[out.length - 1]).toEqual({ char: '，', reading: '' });
  });
});
