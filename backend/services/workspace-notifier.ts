/**
 * 工作区文件新增通知：TTS/图片等每生成一个文件可调用，供 Electron 转发给前端以触发工作区刷新。
 */
import { EventEmitter } from 'node:events';

export type WorkspaceFileCategory = 'audio' | 'images' | 'llm_logs';

export interface WorkspaceFileAddedPayload {
  sessionId: string;
  category: WorkspaceFileCategory;
}

const notifier = new EventEmitter();
notifier.setMaxListeners(20);

export const workspaceNotifier = notifier;

export function notifyWorkspaceFileAdded(
  sessionId: string,
  category: WorkspaceFileCategory
): void {
  notifier.emit('fileAdded', { sessionId, category });
}
