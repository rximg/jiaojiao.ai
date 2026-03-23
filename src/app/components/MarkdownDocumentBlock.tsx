import ReactMarkdown from 'react-markdown';

interface MarkdownDocumentBlockProps {
  content: string;
  title?: string;
}

export default function MarkdownDocumentBlock({ content, title }: MarkdownDocumentBlockProps) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
      <div className="px-3 py-2 text-sm font-medium text-foreground border-b border-border/50">
        {title ?? 'Markdown 文档'}
      </div>
      <div className="px-3 py-3 text-foreground text-sm [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 [&_h1:first-child]:mt-0 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:ml-4 [&_li]:list-disc [&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground [&_blockquote]:pl-3 [&_blockquote]:italic [&_strong]:font-semibold">
        <ReactMarkdown
          components={{
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                {children}
              </a>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}