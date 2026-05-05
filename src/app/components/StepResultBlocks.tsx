import type { StepResult } from '@/types/types';
import DocumentBlock from './DocumentBlock';
import ImageBlock from './ImageBlock';
import AudioBlock from './AudioBlock';

interface StepResultBlocksProps {
  stepResults: StepResult[];
  sessionId?: string | null;
}

export default function StepResultBlocks({ stepResults, sessionId }: StepResultBlocksProps) {
  if (!stepResults?.length) return null;

  // 去重：后端有时会重复上报同一个产物的多种路径表示（绝对/相对）
  const seen = new Set<string>();
  const deduped = stepResults.filter((sr) => {
    const rawPath =
      sr.type === 'image'
        ? sr.payload.path
        : sr.type === 'audio'
          ? sr.payload.path
          : sr.type === 'document'
            ? sr.payload.pathOrContent
            : '';
    const key = `${sr.type}:${String(rawPath ?? '')
      .trim()
      .replace(/^local-file:\/\//, '')
      .replace(/\\/g, '/')
      .toLowerCase()}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <div className="mt-2 space-y-2 flex flex-col gap-2">
      {deduped.map((sr, index) => {
        if (sr.type === 'document') {
          return (
            <DocumentBlock
              key={`doc-${index}`}
              pathOrContent={sr.payload.pathOrContent}
              title={sr.payload.title}
            />
          );
        }
        if (sr.type === 'image') {
          return (
            <ImageBlock
              key={`img-${sr.payload.path}-${index}`}
              path={sr.payload.path}
              prompt={sr.payload.prompt}
              sessionId={sessionId}
            />
          );
        }
        if (sr.type === 'audio') {
          return (
            <AudioBlock
              key={`audio-${sr.payload.path}-${index}`}
              path={sr.payload.path}
              text={sr.payload.text}
            />
          );
        }
        return null;
      })}
    </div>
  );
}
