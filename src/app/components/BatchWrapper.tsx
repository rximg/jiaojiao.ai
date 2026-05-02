import { useState } from 'react';
import type { BatchOperationState } from '@/types/types';
import SubTaskCard from './SubTaskCard';

/** 工具名 → 中文标题映射 */
const BATCH_TITLES: Record<string, string> = {
  generate_image: '批量生成图片',
  edit_image: '批量编辑图片',
  synthesize_speech_single: '批量合成语音',
  generate_audio: '批量生成语音',
};

interface BatchWrapperProps {
  operation: BatchOperationState;
  sessionId?: string | null;
}

export default function BatchWrapper({ operation, sessionId }: BatchWrapperProps) {
  const { toolName, current, total, subTasks } = operation;
  const percent = total === 0 ? 0 : Math.round((current / total) * 100);
  const [expanded, setExpanded] = useState(true);

  const title = BATCH_TITLES[toolName] ?? `批量 ${toolName}`;
  const isComplete = current >= total && total > 0;

  return (
    <div className="rounded-xl border border-border bg-card p-3 mt-2">
      {/* 头部：标题 + 进度 */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm">{title}</span>
        <span className="text-xs tabular-nums text-muted-foreground flex-shrink-0">
          {current}/{total}
          {isComplete ? ' ✓' : ` · ${percent}%`}
        </span>
      </div>

      {/* 进度条 */}
      <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* 子任务列表（可折叠） */}
      {expanded && subTasks.length > 0 && (
        <div className="mt-3 space-y-1.5 max-h-[400px] overflow-auto">
          {subTasks.map((sub) => (
            <SubTaskCard
              key={sub.index}
              subTask={sub}
              toolName={toolName}
              sessionId={sessionId}
            />
          ))}
        </div>
      )}

      {subTasks.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-muted-foreground mt-2 hover:text-foreground transition-colors"
        >
          {expanded ? '收起' : `展开 (${total} 项)`}
        </button>
      )}
    </div>
  );
}
