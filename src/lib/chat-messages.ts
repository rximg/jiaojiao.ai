import type { Message, ToolCall } from '../types/types';

function hasTextContent(content: string): boolean {
  return content.trim().length > 0;
}

function normalizePlanText(input: string): string {
  return input.replace(/\r\n/g, '\n').trim();
}

function looksLikeSamePlanText(a: string, b: string): boolean {
  const na = normalizePlanText(a);
  const nb = normalizePlanText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;

  // 避免误伤：太短的文本不做“包含式”去重
  if (shorter.length < 80) return false;
  if (!longer.includes(shorter)) return false;

  // 只有当短文本几乎等于长文本时，才视为重复（防止正文中引用了一段而被误隐藏）
  const ratio = shorter.length / longer.length;
  return ratio >= 0.92;
}

export function isRenderableMessage(message: Pick<Message, 'content' | 'stepResults' | 'batchOperation' | 'ttsProgress' | 'toolCalls' | 'hitlBlock'>): boolean {
  if (hasTextContent(message.content)) {
    return true;
  }

  if (message.hitlBlock) {
    return true;
  }

  if (Array.isArray(message.stepResults) && message.stepResults.length > 0) {
    return true;
  }

  if (message.batchOperation) {
    return true;
  }

  if (message.ttsProgress && message.ttsProgress.total > 0) {
    return true;
  }

  return Array.isArray(message.toolCalls) && message.toolCalls.length > 0;
}

/**
 * 仅用于 UI 渲染：当 assistant 已输出 `story.plan_review` 的 markdownContent，紧接着又出现 HITL 确认块，避免“方案正文”重复显示两遍。
 *
 * 规则（刻意保守，避免误伤）：
 * - 当前消息必须是 assistant 且有正文，且自身不带 hitlBlock
 * - 下一条消息必须是 assistant 且带 hitlBlock.actionType === 'story.plan_review'
 * - 当前正文与 hitlBlock.payload.markdownContent 高度相似（相等或近似包含）
 */
export function shouldSuppressAssistantPlanMessage(messages: Message[], index: number): boolean {
  const current = messages[index];
  const next = messages[index + 1];
  if (!current || !next) return false;
  if (current.role !== 'assistant') return false;
  if (current.hitlBlock) return false;
  if (!hasTextContent(current.content)) return false;

  const hitl = next.hitlBlock;
  if (!hitl || hitl.actionType !== 'story.plan_review') return false;

  const payload = hitl.payload as unknown;
  const markdownContent =
    payload && typeof payload === 'object' && 'markdownContent' in payload && typeof (payload as { markdownContent?: unknown }).markdownContent === 'string'
      ? (payload as { markdownContent: string }).markdownContent
      : '';

  return looksLikeSamePlanText(current.content, markdownContent);
}

function mergeToolCallLists(existing: ToolCall[] | undefined, incoming: ToolCall[]): ToolCall[] {
  const merged = new Map<string, ToolCall>();

  for (const toolCall of existing ?? []) {
    merged.set(toolCall.id, toolCall);
  }

  for (const toolCall of incoming) {
    const previous = merged.get(toolCall.id);
    merged.set(toolCall.id, previous ? { ...previous, ...toolCall } : toolCall);
  }

  return [...merged.values()];
}

export function mergeToolCallsIntoMessages(
  messages: Message[],
  messageId: string | undefined,
  toolCalls: ToolCall[]
): Message[] {
  if (!messageId || toolCalls.length === 0) {
    return messages;
  }

  return messages.map((message) =>
    message.id === messageId
      ? { ...message, toolCalls: mergeToolCallLists(message.toolCalls, toolCalls) }
      : message
  );
}

/** 同一会话内同一 HITL requestId 只保留首条，修复多路监听等导致的重复落盘 */
export function dedupeHitlMessagesByRequestId(messages: Message[]): Message[] {
  const seen = new Set<string>();
  return messages.filter((message) => {
    const rid = message.hitlBlock?.requestId;
    if (!rid) {
      return true;
    }
    if (seen.has(rid)) {
      return false;
    }
    seen.add(rid);
    return true;
  });
}

export function sanitizeMessages(messages: Message[]): Message[] {
  const filtered = messages.filter((message) => message.role !== 'assistant' || isRenderableMessage(message));
  return dedupeHitlMessagesByRequestId(filtered);
}