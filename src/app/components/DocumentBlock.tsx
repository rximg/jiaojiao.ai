import { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, Copy, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DocumentBlockProps {
  pathOrContent: string;
  title?: string;
}

export default function DocumentBlock({ pathOrContent, title }: DocumentBlockProps) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(pathOrContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [pathOrContent]);

  const displayTitle = title ?? '文档';

  return (
    <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{displayTitle}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 text-xs"
              onClick={handleCopy}
            >
              <Copy className="h-3.5 w-3.5 mr-1" />
              {copied ? '已复制' : '复制'}
            </Button>
          </div>
          <pre className="text-xs whitespace-pre-wrap break-words max-h-48 overflow-auto rounded bg-background/80 p-3 border border-border/50 font-sans">
            {pathOrContent}
          </pre>
        </div>
      )}
    </div>
  );
}
