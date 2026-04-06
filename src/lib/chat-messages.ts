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

export function sanitizeMessages(messages: Message[]): Message[] {
  return messages.filter((message) => message.role !== 'assistant' || isRenderableMessage(message));
}