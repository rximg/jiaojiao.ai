import { useEffect, useMemo, useState } from 'react';
import { ZoomIn } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface ImageBlockProps {
  path: string;
  prompt?: string;
  sessionId?: string | null;
}

function isAbsolutePath(input: string): boolean {
  if (!input) return false;
  if (input.startsWith('local-file://')) return true;
  // Windows 绝对路径：C:\ 或 C:/
  if (/^[a-zA-Z]:[\\/]/.test(input)) return true;
  // POSIX 绝对路径仅在明显是系统路径时认为是 absolute（避免把 "/foo.png" 误当成绝对导致无法按 session 解析）
  if (input.startsWith('/')) {
    return (
      input.startsWith('/Users/') ||
      input.startsWith('/home/') ||
      input.startsWith('/var/') ||
      input.startsWith('/Applications/') ||
      input.startsWith('/tmp/')
    );
  }
  return false;
}

export default function ImageBlock({ path, prompt, sessionId }: ImageBlockProps) {
  const [open, setOpen] = useState(false);
  const [resolvedPath, setResolvedPath] = useState(path);

  useEffect(() => {
    let cancelled = false;

    const resolvePath = async () => {
      if (isAbsolutePath(path) || !sessionId || typeof window.electronAPI?.fs?.getFilePath !== 'function') {
        if (!cancelled) setResolvedPath(path);
        return;
      }

      try {
        const candidate = path.startsWith('/') ? path.slice(1) : path;
        const { path: fullPath } = await window.electronAPI.fs.getFilePath(sessionId, candidate);
        if (!cancelled) setResolvedPath(fullPath || path);
      } catch {
        if (!cancelled) setResolvedPath(path);
      }
    };

    resolvePath();
    return () => {
      cancelled = true;
    };
  }, [path, sessionId]);

  const imageSrc = useMemo(() => {
    if (resolvedPath.startsWith('local-file://')) return resolvedPath;
    return `local-file://${encodeURIComponent(resolvedPath)}`;
  }, [resolvedPath]);

  return (
    <>
      <div
        className="relative group cursor-pointer rounded-lg overflow-hidden border border-border bg-muted hover:border-primary transition-colors aspect-square max-w-[200px]"
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setOpen(true)}
      >
        <img
          src={imageSrc}
          alt={prompt ?? '图像'}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
          <ZoomIn className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>图像预览</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <img
              src={imageSrc}
              alt={prompt ?? '图像预览'}
              className="w-full rounded-lg"
            />
            {prompt && (
              <div className="space-y-1">
                <div className="text-sm font-medium">提示词</div>
                <div className="text-sm text-muted-foreground bg-muted p-3 rounded-md">{prompt}</div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
