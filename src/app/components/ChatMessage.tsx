import { User, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message } from '@/types/types';
import StepResultBlocks from './StepResultBlocks';
import BatchWrapper from './BatchWrapper';

interface ChatMessageProps {
  message: Message;
  sessionId?: string | null;
}

export default function ChatMessage({ message, sessionId }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div
      className={cn(
        'flex gap-4',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
          <Bot className="h-4 w-4 text-primary" />
        </div>
      )}
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-4 py-3 shadow-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground'
        )}
      >
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
        {message.batchOperation && (
          <BatchWrapper operation={message.batchOperation} sessionId={sessionId} />
        )}
        {!message.batchOperation && message.ttsProgress && message.ttsProgress.total > 0 && (
          <div className="mt-2 text-xs opacity-70">
            已生成 {message.ttsProgress.current} / {message.ttsProgress.total} 份文件
          </div>
        )}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-1">
            {message.toolCalls.map((toolCall) => (
              <div
                key={toolCall.id}
                className="text-xs opacity-70 border-t border-border/50 pt-2 mt-2"
              >
                <div className="font-medium">工具: {toolCall.name}</div>
                {toolCall.status === 'completed' && toolCall.result && (
                  <div className="mt-1 opacity-60">{toolCall.result}</div>
                )}
              </div>
            ))}
          </div>
        )}
        {message.stepResults && message.stepResults.length > 0 && (
          <StepResultBlocks stepResults={message.stepResults} sessionId={sessionId} />
        )}
      </div>
      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
          <User className="h-4 w-4 text-primary" />
        </div>
      )}
    </div>
  );
}
