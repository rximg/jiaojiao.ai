import { useState, useCallback, useEffect } from 'react';
import { FileText } from 'lucide-react';

interface EditableDocumentBlockProps {
  /** 初始/受控内容 */
  value: string;
  /** 内容变化回调 */
  onChange: (value: string) => void;
  /** 标题 */
  title?: string;
  /** 占位符 */
  placeholder?: string;
  /** 最小高度（行数） */
  minRows?: number;
  /** 是否禁用（已确认的只读展示） */
  disabled?: boolean;
  /** 为 true 时不渲染顶部标题行（由外层统一展示标题） */
  hideTitleRow?: boolean;
}

/**
 * 可编辑的文档块，用于 HITL 确认框中让用户直接编辑提示词/台词等文本。
 * 占满父容器宽度。
 */
export default function EditableDocumentBlock({
  value,
  onChange,
  title = '文档',
  placeholder = '输入内容...',
  minRows = 6,
  disabled = false,
  hideTitleRow = false,
}: EditableDocumentBlockProps) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value;
      setLocalValue(next);
      onChange(next);
    },
    [onChange]
  );

  return (
    <div className="w-full min-w-0 rounded-lg border border-border bg-muted/30 overflow-hidden">
      {!hideTitleRow && (
        <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-foreground border-b border-border/50">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{title}</span>
        </div>
      )}
      <textarea
        value={localValue}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        rows={minRows}
        className="w-full resize-y min-h-0 px-3 py-2 text-xs whitespace-pre-wrap break-words rounded-b-lg bg-background/80 border-0 focus:ring-1 focus:ring-primary/50 focus:outline-none font-sans disabled:opacity-80 disabled:cursor-not-allowed"
      />
    </div>
  );
}
