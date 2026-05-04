/**
 * 将 VL 模型返回的文本规范为可 JSON.parse 的数组字符串（处理 Markdown 围栏、前言、thinking 等）。
 */
import type { ScriptLine } from '#backend/domain/inference/index.js';

function stripThinkingBlocks(s: string): string {
  // Qwen 等模型在开启思考链时可能在 JSON 外包裹推理块（标签名因版本而异）
  const tagNames = ['redacted_thinking', 'think'];
  let out = s;
  for (const name of tagNames) {
    const re = new RegExp(`<${name}>[\\s\\S]*?</${name}>`, 'gi');
    out = out.replace(re, '');
  }
  return out.trim();
}

function tryParseJsonArray(text: string): unknown[] | null {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** 从首个 `[` 起做括号深度扫描，得到第一个顶层 JSON 数组子串（尊重字符串内的括号）。 */
export function extractFirstTopLevelJsonArray(input: string): string | null {
  const start = input.indexOf('[');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < input.length; i++) {
    const ch = input[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return input.slice(start, i + 1);
    }
  }
  return null;
}

function extractFromMarkdownFences(s: string): string | null {
  const re = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const inner = m[1].trim();
    if (tryParseJsonArray(inner) !== null) return inner;
    const sub = extractFirstTopLevelJsonArray(inner);
    if (sub !== null && tryParseJsonArray(sub) !== null) return sub;
  }
  return null;
}

/**
 * 从模型原始输出中得到可被 JSON.parse 且结果为数组的字符串；失败时抛出与业务层一致的语义错误。
 */
export function extractJsonArrayTextForVlScriptModel(raw: string): string {
  let s = stripThinkingBlocks(raw.trim());
  const fenced = extractFromMarkdownFences(s);
  if (fenced) return fenced;
  if (tryParseJsonArray(s) !== null) return s;
  const slice = extractFirstTopLevelJsonArray(s);
  if (slice !== null && tryParseJsonArray(slice) !== null) return slice;
  throw new Error('VL script response is not valid JSON');
}

export function parseVlScriptLinesFromModelContent(content: string): ScriptLine[] {
  const raw: unknown = JSON.parse(extractJsonArrayTextForVlScriptModel(content));
  if (!Array.isArray(raw)) {
    throw new Error('VL script response must be a JSON array');
  }
  const lines: ScriptLine[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (item == null || typeof item !== 'object') {
      throw new Error(`VL script item at index ${i} must be an object`);
    }
    const o = item as Record<string, unknown>;
    const text = typeof o.text === 'string' ? o.text : String(o.text ?? '');
    const x = typeof o.x === 'number' ? o.x : Number(o.x) || 0;
    const y = typeof o.y === 'number' ? o.y : Number(o.y) || 0;
    const hasW = o.w !== undefined && o.w !== null && String(o.w).length > 0;
    const hasH = o.h !== undefined && o.h !== null && String(o.h).length > 0;
    const w = hasW ? (typeof o.w === 'number' ? o.w : Number(o.w) || undefined) : undefined;
    const h = hasH ? (typeof o.h === 'number' ? o.h : Number(o.h) || undefined) : undefined;
    const line: ScriptLine = { text, x, y };
    if (w !== undefined && !Number.isNaN(w)) line.w = w;
    if (h !== undefined && !Number.isNaN(h)) line.h = h;
    lines.push(line);
  }
  return lines;
}
