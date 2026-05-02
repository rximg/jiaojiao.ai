import { CheckCircle2, XCircle, Loader2, Clock3 } from 'lucide-react';
import ImageBlock from './ImageBlock';
import AudioBlock from './AudioBlock';

interface SubTaskState {
  index: number;
  label?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  result?: unknown;
  error?: string;
}

interface SubTaskCardProps {
  subTask: SubTaskState;
  toolName: string;
  sessionId?: string | null;
}

/** 根据工具名复用现有的 ImageBlock / AudioBlock */
function ResultRenderer({
  toolName,
  result,
  sessionId,
}: {
  toolName: string;
  result: unknown;
  sessionId?: string | null;
}) {
  let data: Record<string, unknown> = {};
  if (typeof result === 'string') {
    try {
      data = JSON.parse(result);
    } catch {
      data = {};
    }
  } else if (result && typeof result === 'object') {
    data = result as Record<string, unknown>;
  }

  if (toolName === 'generate_image' || toolName === 'edit_image') {
    const path = ((data.imagePath ?? data.imageUri ?? '') as string) || '';
    if (!path) return null;
    return (
      <ImageBlock
        path={path}
        prompt={data.prompt as string | undefined}
        sessionId={sessionId}
      />
    );
  }

  if (
    toolName === 'synthesize_speech_single' ||
    toolName === 'synthesize_speech' ||
    toolName === 'generate_audio'
  ) {
    const path = ((data.audioPath ?? data.path ?? '') as string) || '';
    if (!path) return null;
    return <AudioBlock path={path} text={data.text as string | undefined} />;
  }

  return (
    <pre className="text-xs whitespace-pre-wrap break-words overflow-auto max-h-20 rounded bg-background/60 p-1 mt-1">
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}

export default function SubTaskCard({ subTask, toolName, sessionId }: SubTaskCardProps) {
  const { index, label, status, result, error } = subTask;

  return (
    <div className="rounded-lg border border-border/60 p-2 flex items-start gap-2 bg-background/40">
      {/* 状态图标 */}
      <div className="mt-0.5 flex-shrink-0">
        {status === 'completed' && (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        )}
        {status === 'running' && (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        )}
        {status === 'error' && (
          <XCircle className="h-4 w-4 text-red-500" />
        )}
        {status === 'pending' && (
          <Clock3 className="h-4 w-4 text-muted-foreground/60" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">
          #{index} {label ?? ''}
        </div>

        {status === 'running' && (
          <div className="text-xs text-muted-foreground mt-0.5">执行中…</div>
        )}
        {status === 'pending' && (
          <div className="text-xs text-muted-foreground/60 mt-0.5">等待中</div>
        )}
        {status === 'completed' && result != null && (
          <ResultRenderer toolName={toolName} result={result} sessionId={sessionId} />
        )}
        {status === 'error' && error && (
          <div className="text-xs text-red-500 mt-0.5 break-all">{error}</div>
        )}
      </div>
    </div>
  );
}
