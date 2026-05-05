import type { Message, ToolCall } from '../types/types';

function hasTextContent(content: string): boolean {
  return content.trim().length > 0;
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