import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Eye, EyeOff, FolderOpen, Folder } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AppConfig } from '@/types/types';
import { DASHSCOPE_APPLY_STEPS, ZHIPU_APPLY_STEPS } from '@/data/api-key-apply-steps';

/** LLM 选项类型：从 backend/config/ai_models.json 动态加载 */
type LLMOpts = { default: string; models: Array<{ id: string; label: string }> };
const FALLBACK_LLM_OPTIONS: Record<string, LLMOpts> = {
  dashscope: {
    default: 'qwen-plus-2025-12-01',
    models: [
      { id: 'qwen-plus-2025-12-01', label: '通义 Qwen Plus' },
      { id: 'qwen-turbo', label: '通义 Qwen Turbo' },
    ],
  },
  zhipu: {
    default: 'glm-4.5-air',
    models: [
      { id: 'glm-4.5', label: '智谱 GLM-4.5' },
      { id: 'glm-4.5-air', label: '智谱 GLM-4.5 Air' },
      { id: 'glm-4.5-flash', label: '智谱 GLM-4.5 Flash' },
      { id: 'glm-4.6', label: '智谱 GLM-4.6' },
      { id: 'glm-4.7', label: '智谱 GLM-4.7' },
    ],
  },
};

type LlmProvider = 'dashscope' | 'zhipu';
type MultimodalProvider = 'dashscope' | 'zhipu' | 'jiaojiao';

interface ConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: Partial<AppConfig>) => Promise<void>;
  initialConfig?: AppConfig | null;
}

export default function ConfigDialog({
  open,
  onOpenChange,
  onSave,
  initialConfig,
}: ConfigDialogProps) {
  const [provider, setProvider] = useState<LlmProvider>('dashscope');
  const [llmOptions, setLlmOptions] = useState<Record<string, LLMOpts>>(FALLBACK_LLM_OPTIONS);
  const [dashscopeApiKey, setDashscopeApiKey] = useState('');
  const [zhipuApiKey, setZhipuApiKey] = useState('');
  /** 当前选中的 LLM 模型（agent.current）；首次为空时在下方赋值为 default，下拉即有显示 */
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState(0.1);
  const [maxTokens, setMaxTokens] = useState(20000);
  const [syncTargetPath, setSyncTargetPath] = useState('');
  const [ttsStartNumber, setTtsStartNumber] = useState(6000);
  const [applyStepsOpen, setApplyStepsOpen] = useState(false);
  /** 多模态（VL/TTS/T2I）供应商与 API Key */
  const [multimodalProvider, setMultimodalProvider] = useState<MultimodalProvider>('dashscope');
  const [multimodalDashscopeKey, setMultimodalDashscopeKey] = useState('');
  const [multimodalZhipuKey, setMultimodalZhipuKey] = useState('');
  const [jiaojiaoApiKey, setJiaojiaoApiKey] = useState('');
  const [applyStepsFor, setApplyStepsFor] = useState<'llm' | 'multimodal'>('llm');
  /** 是否显示 LLM / 多模态 API Key 明文（各自控制） */
  const [showLlmApiKey, setShowLlmApiKey] = useState(false);
  const [showMultimodalApiKey, setShowMultimodalApiKey] = useState(false);

  /** 弹窗打开时从 backend/config/ai_models.json 加载 LLM 模型列表 */
  const loadLlmOptions = useCallback(async () => {
    try {
      const api = (window as Window & { electronAPI?: { config?: { getAiModels?: () => Promise<Record<string, LLMOpts>> } } }).electronAPI;
      if (api?.config?.getAiModels) {
        const opts = await api.config.getAiModels();
        if (opts && (opts.dashscope?.models?.length || opts.zhipu?.models?.length)) {
          setLlmOptions(opts);
        }
      }
    } catch (e) {
      console.warn('[ConfigDialog] getAiModels failed:', e);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadLlmOptions();
    }
  }, [open, loadLlmOptions]);

  useEffect(() => {
    if (open && initialConfig) {
      const p = (initialConfig.agent?.provider === 'zhipu' ? 'zhipu' : 'dashscope') as LlmProvider;
      setProvider(p);
      setDashscopeApiKey(initialConfig.apiKeys?.dashscope ?? '');
      setZhipuApiKey(initialConfig.apiKeys?.zhipu ?? '');
      const mmp = (initialConfig.agent?.multimodalProvider === 'zhipu' ? 'zhipu' :
        initialConfig.agent?.multimodalProvider === 'jiaojiao' ? 'jiaojiao' : 'dashscope') as MultimodalProvider;
      setMultimodalProvider(mmp);
      setMultimodalDashscopeKey(initialConfig.multimodalApiKeys?.dashscope ?? '');
      setMultimodalZhipuKey(initialConfig.multimodalApiKeys?.zhipu ?? '');
      setJiaojiaoApiKey((initialConfig.multimodalApiKeys as Record<string, string> | undefined)?.jiaojiao ?? '');
      const opts = llmOptions[p] ?? FALLBACK_LLM_OPTIONS[p];
      const currentRaw = (initialConfig.agent?.current ?? initialConfig.agent?.model ?? '').trim();
      const currentOrDefault = currentRaw && opts.models.some((m) => m.id === currentRaw)
        ? currentRaw
        : opts.default;
      setModel(currentOrDefault);
      setTemperature(initialConfig.agent?.temperature ?? 0.1);
      setMaxTokens(initialConfig.agent?.maxTokens ?? 20000);
      setSyncTargetPath(initialConfig.storage?.syncTargetPath ?? initialConfig.storage?.outputPath ?? '');
      setTtsStartNumber(initialConfig.storage?.ttsStartNumber ?? 6000);
    }
  }, [open, initialConfig, llmOptions]);

  useEffect(() => {
    if (!open) return;
    const opts = llmOptions[provider] ?? FALLBACK_LLM_OPTIONS[provider];
    const valid = opts.models.some((m) => m.id === model);
    if (!valid) setModel(opts.default);
  }, [open, provider, model, llmOptions]);

  const currentApiKey = provider === 'dashscope' ? dashscopeApiKey : zhipuApiKey;
  const setCurrentApiKey = provider === 'dashscope' ? setDashscopeApiKey : setZhipuApiKey;
  const llmOpts = llmOptions[provider] ?? FALLBACK_LLM_OPTIONS[provider];
  const currentMultimodalKey = multimodalProvider === 'dashscope' ? multimodalDashscopeKey :
    multimodalProvider === 'zhipu' ? multimodalZhipuKey : jiaojiaoApiKey;
  const setCurrentMultimodalKey = multimodalProvider === 'dashscope' ? setMultimodalDashscopeKey :
    multimodalProvider === 'zhipu' ? setMultimodalZhipuKey : setJiaojiaoApiKey;

  /** 简单校验：避免误将模型名当成 API Key 保存（API Key 通常为 sk- 或一长串 token） */
  const looksLikeModelId = (s: string): boolean => {
    const t = s.trim();
    return /^(qwen-|glm-|wan\d)/i.test(t) || (t.length > 0 && t.length < 30 && !/^sk-|^[a-f0-9.-]{30,}/i.test(t));
  };

  const handleSave = async () => {
    const hasLlmKey = Boolean(dashscopeApiKey.trim() || zhipuApiKey.trim());
    const hasMultimodalKey = Boolean(multimodalDashscopeKey.trim() || multimodalZhipuKey.trim() || jiaojiaoApiKey.trim());
    if (!hasLlmKey) {
      alert('请至少填写 LLM（大语言模型）的一个供应商 API Key');
      return;
    }
    if (!hasMultimodalKey) {
      alert('请至少填写多模态（视觉/语音/图像）的一个供应商 API Key');
      return;
    }
    // jiaojiao SK 格式自定义，不做模型名检测；dashscope/zhipu 仍检测
    if (looksLikeModelId(multimodalDashscopeKey) || looksLikeModelId(multimodalZhipuKey)) {
      alert('多模态 API Key 不能填写模型名称，请填写真实的 API Key（如 sk- 开头或平台提供的密钥）');
      return;
    }
    if (looksLikeModelId(dashscopeApiKey) || looksLikeModelId(zhipuApiKey)) {
      alert('LLM API Key 不能填写模型名称，请填写真实的 API Key（如 sk- 开头或平台提供的密钥）');
      return;
    }

    try {
      await onSave({
        apiKeys: {
          dashscope: dashscopeApiKey.trim() || undefined,
          zhipu: zhipuApiKey.trim() || undefined,
        },
        multimodalApiKeys: {
          dashscope: multimodalDashscopeKey.trim() || undefined,
          zhipu: multimodalZhipuKey.trim() || undefined,
          jiaojiao: jiaojiaoApiKey.trim() || undefined,
        } as AppConfig['multimodalApiKeys'],
        agent: {
          model: model || llmOpts.default,
          current: model || llmOpts.default,
          temperature,
          maxTokens,
          provider,
          multimodalProvider,
        },
        storage: {
          outputPath: '',
          syncTargetPath,
          ttsStartNumber,
        },
        ui: {
          theme: 'light',
          language: 'zh',
        },
      });
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to save config:', error);
      alert('保存配置失败');
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col p-4 sm:p-6">
        <div className="flex flex-col gap-4 min-h-0 flex-1 overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>配置</DialogTitle>
            <DialogDescription>
              配置 API Key 和 Agent 参数。配置将保存在本地。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 py-4 overflow-y-auto min-h-0 flex-1 pr-1 -mr-1">
          {/* LLM（大语言模型） */}
          <div className="space-y-3 rounded-lg border border-border p-3">
            <h3 className="text-sm font-medium text-foreground">LLM（大语言模型）</h3>
            <div className="space-y-2">
              <Label htmlFor="provider" className="text-foreground">供应商</Label>
              <div className="flex gap-2">
                <select
                  id="provider"
                  className="flex h-9 flex-1 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as LlmProvider)}
                >
                  <option value="dashscope">阿里百炼</option>
                  <option value="zhipu">智谱</option>
                </select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 rounded-md"
                  onClick={() => { setApplyStepsFor('llm'); setApplyStepsOpen(true); }}
                >
                  申请
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="apikey" className="text-foreground">API Key</Label>
              <div className="relative">
                <Input
                  id="apikey"
                  type={showLlmApiKey ? 'text' : 'password'}
                  placeholder={provider === 'dashscope' ? 'sk-...（阿里百炼）' : 'sk-...（智谱）'}
                  value={currentApiKey}
                  onChange={(e) => setCurrentApiKey(e.target.value)}
                  className="pr-9"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-2 text-muted-foreground hover:bg-transparent"
                  onClick={() => setShowLlmApiKey((v) => !v)}
                  title={showLlmApiKey ? '隐藏' : '显示'}
                >
                  {showLlmApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="model" className="text-foreground">模型</Label>
              <select
                id="model"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={model || llmOpts.default}
                onChange={(e) => setModel(e.target.value)}
              >
                {llmOpts.models.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
              <div className="space-y-2">
                <Label htmlFor="temperature" className="text-foreground">温度</Label>
                <Input
                  id="temperature"
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxTokens" className="text-foreground">最大 Token 数</Label>
              <Input
                id="maxTokens"
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value))}
              />
            </div>
          </div>

          {/* 多模态（视觉/语音/图像） */}
          <div className="space-y-3 rounded-lg border border-border p-3">
            <h3 className="text-sm font-medium text-foreground">多模态（视觉/语音/图像）</h3>
            <div className="space-y-2">
              <Label htmlFor="multimodalProvider" className="text-foreground">供应商</Label>
              <div className="flex gap-2">
                <select
                  id="multimodalProvider"
                  className="flex h-9 flex-1 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={multimodalProvider}
                  onChange={(e) => setMultimodalProvider(e.target.value as MultimodalProvider)}
                >
                  <option value="dashscope">阿里百炼</option>
                  <option value="zhipu">智谱</option>
                  <option value="jiaojiao">嘉嘉（本地网关）</option>
                </select>
                {multimodalProvider !== 'jiaojiao' && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 rounded-md"
                    onClick={() => { setApplyStepsFor('multimodal'); setApplyStepsOpen(true); }}
                  >
                    申请
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="multimodalApikey" className="text-foreground">
                {multimodalProvider === 'jiaojiao' ? '网关密钥' : 'API Key'}
              </Label>
              <div className="relative">
                <Input
                  id="multimodalApikey"
                  type={showMultimodalApiKey ? 'text' : 'password'}
                  placeholder={
                    multimodalProvider === 'dashscope' ? 'sk-...（阿里百炼）' :
                    multimodalProvider === 'zhipu' ? 'sk-...（智谱）' :
                    'jjtk-...（嘉嘉网关密钥）'
                  }
                  value={currentMultimodalKey}
                  onChange={(e) => setCurrentMultimodalKey(e.target.value)}
                  className="pr-9"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-2 text-muted-foreground hover:bg-transparent"
                  onClick={() => setShowMultimodalApiKey((v) => !v)}
                  title={showMultimodalApiKey ? '隐藏' : '显示'}
                >
                  {showMultimodalApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>

          {/* <div className="space-y-2">
            <Label className="text-foreground">工作目录（只读）</Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={workspaceDir}
                className="flex-1 min-w-0 bg-muted text-muted-foreground"
                placeholder="固定于 AppData，不可配置"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => workspaceDir && window.electronAPI?.config?.openFolder?.(workspaceDir)}
              >
                <Folder className="h-4 w-4 mr-1" />
                打开
              </Button>
            </div>
          </div> */}
          <div className="space-y-2">
            <Label htmlFor="syncTargetPath" className="text-foreground">音频同步目标路径</Label>
            <div className="flex gap-2">
              <Input
                id="syncTargetPath"
                value={syncTargetPath}
                onChange={(e) => setSyncTargetPath(e.target.value)}
                placeholder="点击「同步」时，将工作目录下的音频复制到此目录"
                className="flex-1 min-w-0"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={async () => {
                  const api = window.electronAPI?.config;
                  if (!api?.showOutputPathDialog) return;
                  const chosen = await api.showOutputPathDialog(syncTargetPath || undefined);
                  if (chosen) setSyncTargetPath(chosen);
                }}
              >
                <FolderOpen className="h-4 w-4 mr-1" />
                选择
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ttsStartNumber" className="text-foreground">TTS 起始编号</Label>
            <Input
              id="ttsStartNumber"
              type="number"
              min={1}
              value={ttsStartNumber}
              onChange={(e) => setTtsStartNumber(parseInt(e.target.value, 10) || 6000)}
            />
          </div>
          <div className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => window.electronAPI?.config?.openConfigDir?.()}
            >
              <Folder className="h-4 w-4 mr-2" />
              打开配置文件夹
            </Button>
          </div>
        </div>
        </div>
        <DialogFooter className="shrink-0 gap-2 sm:gap-2 pt-2 border-t border-border">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-lg">
            取消
          </Button>
          <Button onClick={handleSave} className="rounded-lg">保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* 申请步骤弹窗：按当前供应商显示对应 Markdown 文档 */}
    <Dialog open={applyStepsOpen} onOpenChange={setApplyStepsOpen}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {applyStepsFor === 'llm' ? (provider === 'dashscope' ? '阿里百炼' : '智谱') : (multimodalProvider === 'dashscope' ? '阿里百炼' : '智谱')} API Key 申请步骤
          </DialogTitle>
          <DialogDescription>按以下步骤申请并获取 API Key，填入{applyStepsFor === 'llm' ? 'LLM' : '多模态'}对应输入框后保存。</DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto pr-2 -mr-2 border-t border-border pt-4 mt-1 text-foreground text-sm [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 [&_h1:first-child]:mt-0 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:ml-4 [&_li]:list-disc [&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground [&_blockquote]:pl-3 [&_blockquote]:italic [&_strong]:font-semibold">
          <ReactMarkdown
            components={{
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                  {children}
                </a>
              ),
            }}
          >
            {(applyStepsFor === 'llm' ? provider : multimodalProvider) === 'dashscope' ? DASHSCOPE_APPLY_STEPS : ZHIPU_APPLY_STEPS}
          </ReactMarkdown>
        </div>
        <DialogFooter className="shrink-0 pt-4">
          <Button variant="outline" onClick={() => setApplyStepsOpen(false)} className="rounded-lg">
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
  );
}
