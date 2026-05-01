import { useMemo, useState } from 'react';
import { ZoomIn, Play, Pause, FileJson } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface ArtifactViewerProps {
  artifacts?: {
    images?: Array<{ path: string; prompt?: string }>;
    audio?: Array<{ path: string; text?: string }>;
    llmOutput?: any;
  };
}

export default function ArtifactViewer({ artifacts }: ArtifactViewerProps) {
  const [selectedImage, setSelectedImage] = useState<{ path: string; prompt?: string } | null>(null);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const [showLLMOutput, setShowLLMOutput] = useState(false);

  const normalizePath = (path: string) => path.trim().replace(/\\/g, '/').toLowerCase();

  const uniqueImages = useMemo(() => {
    const images = artifacts?.images ?? [];
    const seen = new Set<string>();
    return images.filter((img) => {
      const key = normalizePath(img.path);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [artifacts?.images]);

  const uniqueAudio = useMemo(() => {
    const audio = artifacts?.audio ?? [];
    const seen = new Set<string>();
    return audio.filter((item) => {
      const key = normalizePath(item.path);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [artifacts?.audio]);

  if (!artifacts) return null;

  const hasArtifacts = uniqueImages.length > 0 ||
                       uniqueAudio.length > 0 ||
                       artifacts.llmOutput;

  if (!hasArtifacts) return null;

  const handleAudioPlay = (path: string) => {
    setPlayingAudio(path);
  };

  const handleAudioPause = () => {
    setPlayingAudio(null);
  };

  return (
    <div className="mt-2 space-y-2">
      {/* 图片展示 */}
      {uniqueImages.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground font-medium">生成的图像 ({uniqueImages.length})</div>
          <div className="grid grid-cols-3 gap-2">
            {uniqueImages.map((img) => (
              <div
                key={img.path}
                className="relative group cursor-pointer rounded-md overflow-hidden border border-border bg-muted hover:border-primary transition-colors aspect-square"
                onClick={() => setSelectedImage(img)}
              >
                <img
                  src={`local-file://${encodeURIComponent(img.path)}`}
                  alt={img.prompt || '图像'}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                  <ZoomIn className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 音频播放器 */}
      {uniqueAudio.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground font-medium">生成的音频 ({uniqueAudio.length})</div>
          <div className="space-y-1">
            {uniqueAudio.map((audio) => {
              const audioId = `audio-${audio.path.replace(/[^a-zA-Z0-9]/g, '-')}`;
              return (
                <div
                  key={audio.path}
                  className="flex items-center gap-2 p-2 rounded-md bg-card border border-border hover:border-primary transition-colors"
                >
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={() => {
                      if (playingAudio === audio.path) {
                        handleAudioPause();
                        const audioEl = document.getElementById(audioId) as HTMLAudioElement;
                        audioEl?.pause();
                      } else {
                        handleAudioPlay(audio.path);
                        const audioEl = document.getElementById(audioId) as HTMLAudioElement;
                        audioEl?.play();
                      }
                    }}
                  >
                    {playingAudio === audio.path ? (
                      <Pause className="w-4 h-4" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                  </Button>
                  <audio
                    id={audioId}
                    src={`local-file://${encodeURIComponent(audio.path)}`}
                    className="flex-1 h-8"
                    controls
                    onEnded={() => handleAudioPause()}
                  />
                {audio.text && (
                  <div className="text-xs text-muted-foreground truncate max-w-[150px]">
                    {audio.text}
                  </div>
                )}
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* LLM输出结果 */}
      {artifacts.llmOutput && (
        <div className="space-y-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowLLMOutput(true)}
            className="w-full justify-start text-xs"
          >
            <FileJson className="w-4 h-4 mr-2" />
            查看LLM解析结果
          </Button>
        </div>
      )}

      {/* 图片预览对话框 */}
      {selectedImage && (
        <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>图像预览</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <img
                src={`local-file://${encodeURIComponent(selectedImage.path)}`}
                alt={selectedImage.prompt || '图像预览'}
                className="w-full rounded-lg"
              />
              {selectedImage.prompt && (
                <div className="space-y-1">
                  <div className="text-sm font-medium">提示词</div>
                  <div className="text-sm text-muted-foreground bg-muted p-3 rounded-md">
                    {selectedImage.prompt}
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* LLM输出对话框 */}
      {showLLMOutput && artifacts.llmOutput && (
        <Dialog open={showLLMOutput} onOpenChange={setShowLLMOutput}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>LLM解析结果</DialogTitle>
            </DialogHeader>
            <div className="max-h-96 overflow-auto">
              <pre className="text-xs bg-muted p-4 rounded-md overflow-x-auto">
                <code>{JSON.stringify(artifacts.llmOutput, null, 2)}</code>
              </pre>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
