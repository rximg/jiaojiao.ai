// 仅用于 `npx tsc -p tsconfig.json --noEmit` 的类型验证：
// - 该文件不被运行时入口 import，因此不会进入打包产物
// - 但会被 tsconfig include 编译，从而验证 preload 的 Window 类型契约

import type { AgentTokenUsageEvent } from '../types/types';

window.electronAPI.agent.onTokenUsage((_event: AgentTokenUsageEvent) => {
  void _event;
});

