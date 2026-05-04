import { describe, it, expect } from 'vitest';
import {
  extractFirstTopLevelJsonArray,
  extractJsonArrayTextForVlScriptModel,
  parseVlScriptLinesFromModelContent,
} from '../../../backend/infrastructure/inference/vl-script-response.js';

describe('vl-script-response', () => {
  it('extractFirstTopLevelJsonArray respects strings containing brackets', () => {
    const s = 'prefix [{"text": "a [b]", "x": 1, "y": 2}] suffix';
    const sub = extractFirstTopLevelJsonArray(s);
    expect(sub).toBe('[{"text": "a [b]", "x": 1, "y": 2}]');
    expect(JSON.parse(sub!)).toEqual([{ text: 'a [b]', x: 1, y: 2 }]);
  });

  it('extractJsonArrayTextForVlScriptModel strips markdown json fence', () => {
    const raw = '```json\n[{"text":"hi","x":10,"y":20}]\n```';
    expect(extractJsonArrayTextForVlScriptModel(raw)).toBe('[{"text":"hi","x":10,"y":20}]');
  });

  it('extractJsonArrayTextForVlScriptModel handles preamble before array', () => {
    const raw = '好的，分析如下：\n[{"text":"鸟","x":1,"y":2}]\n希望有帮助。';
    const t = extractJsonArrayTextForVlScriptModel(raw);
    expect(JSON.parse(t)).toEqual([{ text: '鸟', x: 1, y: 2 }]);
  });

  it('parseVlScriptLinesFromModelContent accepts thinking block + markdown fence', () => {
    const raw =
      '<think>推理中</think>\n\n```json\n[{"text":"a","x":1,"y":2}]\n```';
    const lines = parseVlScriptLinesFromModelContent(raw);
    expect(lines).toEqual([{ text: 'a', x: 1, y: 2 }]);
  });

  it('parseVlScriptLinesFromModelContent coerces string x/y to numbers', () => {
    const raw = '[{"text":"a","x":"100","y":"200"}]';
    const lines = parseVlScriptLinesFromModelContent(raw);
    expect(lines[0].x).toBe(100);
    expect(lines[0].y).toBe(200);
  });

  it('parseVlScriptLinesFromModelContent parses optional w and h', () => {
    const raw = '[{"text":"字幕","x":0.1,"y":0.2,"w":0.5,"h":0.08}]';
    const lines = parseVlScriptLinesFromModelContent(raw);
    expect(lines[0]).toEqual({ text: '字幕', x: 0.1, y: 0.2, w: 0.5, h: 0.08 });
  });

  it('parseVlScriptLinesFromModelContent omits w/h when absent', () => {
    const raw = '[{"text":"a","x":1,"y":2}]';
    const lines = parseVlScriptLinesFromModelContent(raw);
    expect(lines[0].w).toBeUndefined();
    expect(lines[0].h).toBeUndefined();
  });
});
