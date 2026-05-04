import { describe, it, expect } from 'vitest';
import {
  parseCaptionRubyPayload,
  assertCaptionRubyMatchesScriptLines,
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
});
