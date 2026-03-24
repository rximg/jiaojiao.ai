import type { Message } from '../types/types';

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

export function sanitizeMessages(messages: Message[]): Message[] {
  return messages.filter((message) => message.role !== 'assistant' || isRenderableMessage(message));
}