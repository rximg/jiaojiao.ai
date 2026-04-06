# Story-Book Image Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `story-book` 落地 `generate_character_sheet` 与 `generate_storyboard_page`，同时把聊天流图片回显收敛到设计稿要求的语义边界。

**Architecture:** 保留现有 `generate_image` / `edit_image` / `split_grid_image` 的底层实现能力，但把它们抽成可复用 runner，由新的领域工具进行单次 HITL、参数整形、结果整理和显式 step result 回显。前端不新增卡片组件，继续复用现有 `agent:stepResult -> ImageBlock` 链路，只是把“显示哪张图”从文本正则推断升级为工具显式上报。

**Tech Stack:** `deepagents`, `LangChain` tools, `Electron IPC`, `React`, `Vitest`, `sharp`

---

## File Structure

### Runtime / Result Plumbing

- Modify: `backend/application/agent/run-context.ts`
  - 为工具执行期增加显式 `stepResults` 上报能力，复用现有 `messageId` / `toolCallId` 作用域。
- Modify: `backend/application/agent/invoke-agent-use-case.ts`
  - 让显式 step results 优先于正则路径提取，避免 `generate_character_sheet` 的角色单图误刷进聊天流。
- Create: `backend/tools/step-result-emitter.ts`
  - 提供图片 step result 的统一发射 helper，避免两个新工具各自拼装回调。

### Shared Tool Runners

- Modify: `backend/tools/generate-image.ts`
  - 抽出可复用的 `runGenerateImage(...)`，保留现有 `generate_image` 工具外观不变。
- Modify: `backend/tools/edit-image.ts`
  - 抽出可复用的 `runEditImage(...)`，保留尺寸归一化和默认参数逻辑。
- Modify: `backend/tools/split-grid-image.ts`
  - 抽出可复用的 `runSplitGridImage(...)`，供新角色工具内部复用。

### New Domain Tools

- Create: `backend/tools/generate-character-sheet.ts`
  - 调用共享 runner 生成四宫格、切图，并将结果改名为真实角色名对应的文件名（例如 `rabbit_mom.png`、`小兔.png`），删除 slot 中间产物、显式只回显四宫格总图。
- Create: `backend/tools/generate-storyboard-page.ts`
  - 调用共享 runner 生成单页分镜图，显式只回显该页分镜图。
- Modify: `backend/tools/index.ts`
  - 注册两个新工具。

### Story-Book Contract

- Modify: `backend/config/skills/story-book/SKILL.md`
  - 把工作流文案切换到两个领域工具和半结构化执行卡片。
- Modify: `backend/config/skills/story-book/config.yaml`
  - 用新工具替换 story-book 当前公开的低层图像工具。

### Tests

- Create: `tests/unit/application/agent/invoke-agent-use-case-explicit-step-results.test.ts`
- Create: `tests/unit/tools/generate-character-sheet.test.ts`
- Create: `tests/unit/tools/generate-storyboard-page.test.ts`
- Create: `tests/unit/agent/story-book-tool-contract.test.ts`
- Modify: `tests/unit/services/tool-registration-names.test.ts`

### No-Change Decision

- No change: `src/app/components/ImageBlock.tsx`
- No change: `src/app/components/ChatInterface.tsx`
- No change: `src/providers/ChatProvider.tsx`

原因：现有前端已经能消费 `agent:stepResult` 并复用图片块；本轮只需要后端显式控制“回显哪张图”，不需要新增视觉组件。

---

### Task 1: Make Explicit Step Results Override Regex Extraction

**Files:**

- Create: `backend/tools/step-result-emitter.ts`
- Modify: `backend/application/agent/run-context.ts`
- Modify: `backend/application/agent/invoke-agent-use-case.ts`
- Test: `tests/unit/application/agent/invoke-agent-use-case-explicit-step-results.test.ts`
- **Step 1: Write the failing regression test for explicit image step results**

```ts
import { describe, expect, it, vi } from 'vitest';
import { getRunContext } from '../../../../backend/application/agent/run-context.ts';
import { invokeAgentUseCase } from '../../../../backend/application/agent/invoke-agent-use-case.ts';

describe('invokeAgentUseCase explicit step results', () => {
  it('prefers explicit image step results over regex path extraction for the same assistant message', async () => {
    async function* createStream() {
      yield {
        messages: [
          { id: 'assistant-1', type: 'ai', content: '正在生成角色参考图...' },
        ],
      };

      getRunContext()?.emitStepResults?.([
        {
          type: 'image',
          payload: { path: 'E:/tmp/images/character_sheet_4grid.png' },
        },
      ]);

      yield {
        messages: [
          {
            id: 'assistant-1',
            type: 'ai',
            content:
              '角色图已完成：E:/tmp/images/character_sheet_4grid.png，同时生成了 E:/tmp/images/rabbit_mom.png',
          },
        ],
      };
    }

    const onMessage = vi.fn();
    const onStepResult = vi.fn();

    await invokeAgentUseCase(
      {
        createAgent: async () => ({ stream: async () => createStream() }),
        getSessionMessages: async () => [],
      },
      {
        message: 'test',
        signal: new AbortController().signal,
        callbacks: { onMessage, onStepResult },
      }
    );

    expect(onStepResult).toHaveBeenCalledWith(
      expect.any(String),
      'assistant-1',
      [{ type: 'image', payload: { path: 'E:/tmp/images/character_sheet_4grid.png' } }]
    );

    const lastMessageCall = onMessage.mock.calls.at(-1);
    expect(lastMessageCall?.[1]?.[0]?.stepResults).toEqual([
      { type: 'image', payload: { path: 'E:/tmp/images/character_sheet_4grid.png' } },
    ]);
  });
});
```

- **Step 2: Run the focused test and verify it fails**

Run: `npx vitest run tests/unit/application/agent/invoke-agent-use-case-explicit-step-results.test.ts`

Expected: FAIL because `RunContext` does not expose `emitStepResults`, and `invokeAgentUseCase` still only relies on regex extraction.

- **Step 3: Add explicit step-result plumbing**

```ts
// backend/application/agent/run-context.ts
import type { StepResult } from './invoke-agent-use-case.js';

export interface RunContext {
  threadId: string;
  messageId?: string;
  toolCallId?: string;
  onStepResult?: (threadId: string, messageId: string, stepResults: StepResult[]) => void;
  emitStepResults?: (stepResults: StepResult[]) => void;
}
```

```ts
// backend/tools/step-result-emitter.ts
import type { StepResult } from '../application/agent/invoke-agent-use-case.js';
import type { RunContext } from '../application/agent/run-context.js';

export function emitImageStepResult(
  runCtx: RunContext | undefined,
  imagePath: string,
  prompt?: string
): void {
  if (!runCtx?.emitStepResults) return;
  const stepResult: StepResult = {
    type: 'image',
    payload: {
      path: imagePath,
      ...(prompt ? { prompt } : {}),
    },
  };
  runCtx.emitStepResults([stepResult]);
}
```

```ts
// backend/application/agent/invoke-agent-use-case.ts
const explicitStepResults = new Map<string, StepResult[]>();
const messagesWithExplicitStepResults = new Set<string>();

const runCtx: RunContext = {
  threadId: effectiveSessionId,
  onStepResult: callbacks.onStepResult,
  emitStepResults: (stepResults) => {
    if (!runCtx.messageId || !stepResults.length) return;
    messagesWithExplicitStepResults.add(runCtx.messageId);
    explicitStepResults.set(runCtx.messageId, stepResults);
    callbacks.onStepResult?.(effectiveSessionId, runCtx.messageId, stepResults);
  },
};

// when handling assistant messages
const explicit = explicitStepResults.get(stableId) ?? [];
let stepResults =
  explicit.length > 0 || messagesWithExplicitStepResults.has(stableId)
    ? explicit
    : extractStepResultsFromContent(content);
```

- **Step 4: Re-run the focused regression test**

Run: `npx vitest run tests/unit/application/agent/invoke-agent-use-case-explicit-step-results.test.ts`

Expected: PASS with only the explicit `character_sheet_4grid.png` image attached to the assistant message.

- **Step 5: Commit the runtime plumbing**

```bash
git add backend/application/agent/run-context.ts backend/application/agent/invoke-agent-use-case.ts backend/tools/step-result-emitter.ts tests/unit/application/agent/invoke-agent-use-case-explicit-step-results.test.ts
git commit -m "feat: prefer explicit image step results"
```

---

### Task 2: Extract Reusable Low-Level Image Runners

**Files:**

- Modify: `backend/tools/generate-image.ts`
- Modify: `backend/tools/edit-image.ts`
- Modify: `backend/tools/split-grid-image.ts`
- Test: `tests/integration/tools/generate-image.integration.test.ts`
- Test: `tests/integration/tools/split-grid-image.integration.test.ts`
- **Step 1: Write a failing smoke test for the extracted API shape**

```ts
import { describe, expect, it } from 'vitest';
import { runGenerateImage } from '../../../backend/tools/generate-image.ts';
import { runEditImage } from '../../../backend/tools/edit-image.ts';
import { runSplitGridImage } from '../../../backend/tools/split-grid-image.ts';

describe('shared tool runners', () => {
  it('exports reusable runner functions for wrapper tools', () => {
    expect(typeof runGenerateImage).toBe('function');
    expect(typeof runEditImage).toBe('function');
    expect(typeof runSplitGridImage).toBe('function');
  });
});
```

- **Step 2: Run the smoke test and verify it fails**

Run: `npx vitest run tests/unit/tools/shared-image-runners.test.ts`

Expected: FAIL because the runner functions are not exported yet.

- **Step 3: Extract the shared runner functions without changing existing tool behavior**

```ts
// backend/tools/generate-image.ts
export async function runGenerateImage(
  params: GenerateImageRunnerParams,
  config: ToolConfig,
  context: ToolContext
) {
  const merged = await context.requestApprovalViaHITL('ai.text2image', params as Record<string, unknown>);
  // keep current prompt normalization, default size/model logic, and port.generateImage(...) call
}

return tool(async (params) => runGenerateImage(params, config, context), { ... });
```

```ts
// backend/tools/edit-image.ts
export async function runEditImage(
  params: EditImageRunnerParams,
  config: ToolConfig,
  context: ToolContext
) {
  const merged = await context.requestApprovalViaHITL('ai.image_edit', params as Record<string, unknown>);
  // keep current imagePaths merge, size normalization, and port.editImage(...) call
}
```

```ts
// backend/tools/split-grid-image.ts
export async function runSplitGridImage(
  params: { imagePath?: string; outputDir?: string; sessionId?: string },
  context: ToolContext
) {
  // keep current normalizeRelativePath, sharp splitting, artifactRepo.write logic
}
```

- **Step 4: Run the new smoke test plus the existing integration regressions**

Run: `npx vitest run tests/unit/tools/shared-image-runners.test.ts tests/integration/tools/split-grid-image.integration.test.ts`

Expected: PASS.  
Optional provider-backed check when credentials exist: `npx vitest run tests/integration/tools/generate-image.integration.test.ts`

- **Step 5: Commit the shared runner extraction**

```bash
git add backend/tools/generate-image.ts backend/tools/edit-image.ts backend/tools/split-grid-image.ts tests/unit/tools/shared-image-runners.test.ts
git commit -m "refactor: extract reusable image tool runners"
```

---

### Task 3: Implement `generate_character_sheet`

**Files:**

- Create: `backend/tools/generate-character-sheet.ts`
- Modify: `backend/tools/index.ts`
- Modify: `backend/tools/split-grid-image.ts`
- Test: `tests/unit/tools/generate-character-sheet.test.ts`
- Test: `tests/unit/services/tool-registration-names.test.ts`
- **Step 1: Write the failing wrapper test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createTool } from '../../../backend/tools/registry.js';
import '../../../backend/tools/index.js';

vi.mock('../../../backend/tools/generate-image.ts', () => ({
  runGenerateImage: vi.fn().mockResolvedValue({
    imagePath: 'E:/workspace/session/images/character_sheet_4grid.png',
  }),
}));

vi.mock('../../../backend/tools/split-grid-image.ts', () => ({
  runSplitGridImage: vi.fn().mockResolvedValue({
    slotImages: {
      slot1: 'images/character_slot1.png',
      slot2: 'images/character_slot2.png',
      slot3: 'images/character_slot3.png',
      slot4: 'images/character_slot4.png',
    },
  }),
}));

describe('Tools / generate_character_sheet', () => {
  it('returns images named after the real roles and emits only the sheet image to chat', async () => {
    const emitted: any[] = [];
    const tool = await createTool(
      'generate_character_sheet',
      { enable: true, serviceConfig: { default_params: { size: '1024*1024' } } },
      {
        getDefaultSessionId: () => 'story-book-test',
        requestApprovalViaHITL: async (_actionType, payload) => payload,
        getRunContext: () => ({
          threadId: 'story-book-test',
          messageId: 'assistant-1',
          emitStepResults: (stepResults) => emitted.push(stepResults),
        }),
      }
    );

    const result = await tool!.invoke({
      characters: [
        { roleName: 'rabbit_mom', description: '灰兔妈妈，围裙，温柔' },
        { roleName: 'little_rabbit', description: '小兔，红围巾，好奇' },
      ],
      imageName: 'character_sheet_4grid.png',
    });

    expect(result.roleImages).toEqual([
      expect.objectContaining({ roleName: 'rabbit_mom', imagePath: expect.stringContaining('rabbit_mom.png') }),
      expect.objectContaining({ roleName: 'little_rabbit', imagePath: expect.stringContaining('little_rabbit.png') }),
    ]);

    expect(emitted).toEqual([
      [{ type: 'image', payload: { path: 'E:/workspace/session/images/character_sheet_4grid.png' } }],
    ]);
  });
});
```

- **Step 2: Run the wrapper test and registration test to verify failure**

Run: `npx vitest run tests/unit/tools/generate-character-sheet.test.ts tests/unit/services/tool-registration-names.test.ts`

Expected: FAIL because the new tool is not registered and no real-role-name outputs exist.

- **Step 3: Implement the wrapper tool**

```ts
// backend/tools/generate-character-sheet.ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getArtifactRepository } from '../infrastructure/repositories.js';
import { runGenerateImage } from './generate-image.js';
import { runSplitGridImage } from './split-grid-image.js';
import { emitImageStepResult } from './step-result-emitter.js';
import { registerTool } from './registry.js';

function slugifyRoleName(roleName: string): string {
  return roleName.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^\w\u4e00-\u9fa5-]/g, '');
}

// inside invoke:
// 1. HITL once with domain payload
// 2. call runGenerateImage(...) using bypass context
// 3. call runSplitGridImage(...)
// 4. copy slot images to images/<真实角色名>.png，而不是字面写成 role_name.png
// 5. delete slot files
// 6. emit only sheetImagePath through emitImageStepResult(...)
```

```ts
// backend/tools/index.ts
import './generate-character-sheet.js';
```

```ts
// tests/unit/services/tool-registration-names.test.ts
expect(registeredNames).toContain('generate_character_sheet');
expect(registeredNames).toContain('generate_storyboard_page');
```

- **Step 4: Re-run the focused tests**

Run: `npx vitest run tests/unit/tools/generate-character-sheet.test.ts tests/unit/services/tool-registration-names.test.ts tests/integration/tools/split-grid-image.integration.test.ts`

Expected: PASS, and the wrapper test confirms that only the sheet image is emitted as a chat step result.

- **Step 5: Commit the new character-sheet tool**

```bash
git add backend/tools/generate-character-sheet.ts backend/tools/index.ts backend/tools/split-grid-image.ts tests/unit/tools/generate-character-sheet.test.ts tests/unit/services/tool-registration-names.test.ts
git commit -m "feat: add character sheet tool"
```

---

### Task 4: Implement `generate_storyboard_page`

**Files:**

- Create: `backend/tools/generate-storyboard-page.ts`
- Modify: `backend/tools/index.ts`
- Test: `tests/unit/tools/generate-storyboard-page.test.ts`
- **Step 1: Write the failing storyboard wrapper test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createTool } from '../../../backend/tools/registry.js';
import '../../../backend/tools/index.js';

vi.mock('../../../backend/tools/edit-image.ts', () => ({
  runEditImage: vi.fn().mockResolvedValue({
    imagePath: 'E:/workspace/session/images/scene_3.png',
    imageUri: 'file:///scene_3.png',
  }),
}));

describe('Tools / generate_storyboard_page', () => {
  it('delegates to image edit and emits exactly one storyboard image result', async () => {
    const emitted: any[] = [];
    const tool = await createTool(
      'generate_storyboard_page',
      { enable: true, serviceConfig: { default_params: { size: '1472*1104' } } },
      {
        getDefaultSessionId: () => 'story-book-test',
        requestApprovalViaHITL: async (_actionType, payload) => payload,
        getRunContext: () => ({
          threadId: 'story-book-test',
          messageId: 'assistant-2',
          emitStepResults: (stepResults) => emitted.push(stepResults),
        }),
      }
    );

    const result = await tool!.invoke({
      prompt: '参考图1为兔妈妈，参考图2为小兔，在森林里相遇。',
      imagePaths: ['images/rabbit_mom.png', 'images/little_rabbit.png'],
      imageName: 'scene_3.png',
    });

    expect(result).toEqual({
      imagePath: 'E:/workspace/session/images/scene_3.png',
      imageUri: 'file:///scene_3.png',
    });

    expect(emitted).toEqual([
      [{ type: 'image', payload: { path: 'E:/workspace/session/images/scene_3.png' } }],
    ]);
  });
});
```

- **Step 2: Run the focused test and verify it fails**

Run: `npx vitest run tests/unit/tools/generate-storyboard-page.test.ts`

Expected: FAIL because the wrapper tool does not exist yet.

- **Step 3: Implement the storyboard wrapper**

```ts
// backend/tools/generate-storyboard-page.ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { runEditImage } from './edit-image.js';
import { emitImageStepResult } from './step-result-emitter.js';
import { registerTool } from './registry.js';

// inside invoke:
// 1. requestApprovalViaHITL('ai.storyboard_page', params)
// 2. create bypass context so underlying runEditImage does not prompt twice
// 3. call runEditImage(...)
// 4. emitImageStepResult(runCtx, result.imagePath, prompt)
// 5. return { imagePath, imageUri? }
```

- **Step 4: Re-run the storyboard test**

Run: `npx vitest run tests/unit/tools/generate-storyboard-page.test.ts`

Expected: PASS with exactly one emitted image step result.

- **Step 5: Commit the storyboard wrapper**

```bash
git add backend/tools/generate-storyboard-page.ts backend/tools/index.ts tests/unit/tools/generate-storyboard-page.test.ts
git commit -m "feat: add storyboard page tool"
```

---

### Task 5: Align Story-Book Skill and Config With the New Tool Contract

**Files:**

- Modify: `backend/config/skills/story-book/SKILL.md`
- Modify: `backend/config/skills/story-book/config.yaml`
- Create: `tests/unit/agent/story-book-tool-contract.test.ts`
- Test: `tests/unit/agent/deepagents-skill-schema.test.ts`
- **Step 1: Write the failing contract test for story-book public tools**

```ts
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(import.meta.dirname, '..', '..', '..');

describe('story-book tool contract', () => {
  it('exposes only the new domain image tools in story-book config and skill text', () => {
    const skill = fs.readFileSync(path.join(projectRoot, 'backend/config/skills/story-book/SKILL.md'), 'utf-8');
    const config = yaml.load(
      fs.readFileSync(path.join(projectRoot, 'backend/config/skills/story-book/config.yaml'), 'utf-8')
    ) as any;

    expect(skill).toContain('generate_character_sheet');
    expect(skill).toContain('generate_storyboard_page');
    expect(skill).not.toContain('split_grid_image');
    expect(skill).not.toContain('`edit_image`');

    expect(config.tools.generate_character_sheet).toBeDefined();
    expect(config.tools.generate_storyboard_page).toBeDefined();
    expect(config.tools.split_grid_image).toBeUndefined();
    expect(config.tools.edit_image).toBeUndefined();
  });
});
```

- **Step 2: Run the contract test and schema test to verify failure**

Run: `npx vitest run tests/unit/agent/story-book-tool-contract.test.ts tests/unit/agent/deepagents-skill-schema.test.ts`

Expected: FAIL because the current story-book files still reference the low-level image tools.

- **Step 3: Rewrite the story-book skill and config to the new public contract**

```md
## Allowed Tools

- `write_file`
- `edit_file`
- `request_story_plan_review`
- `write_todos`
- `generate_character_sheet`
- `generate_storyboard_page`
- `generate_audio`
- `batch_tool_call`
- `finalize_workflow`
```

```yaml
tools:
  finalize_workflow: {}
  annotate_image_with_numbers: {}
  delete_artifacts: {}
  request_story_plan_review: {}
  generate_character_sheet:
    enable: true
    config_path: ./tools/t2i.yaml
  generate_storyboard_page:
    enable: true
    config_path: ./tools/image_edit.yaml
  generate_audio:
    enable: true
    config_path: ./tools/tts.yaml
  batch_tool_call: {}
```

```md
### 步骤 3：生成角色参考图
- 根据 `《绘本方案.md》` 的角色参考图执行卡片整理 `characters`
- 调用 `generate_character_sheet`
- 后续所有分镜页只使用返回的角色图路径

### 步骤 4：按方案生成分镜图
- 从每页分镜执行卡片读取 prompt / imagePaths / 输出文件
- 调用 `generate_storyboard_page`
- 聊天流只回显当前页分镜图
```

- **Step 4: Run the focused contract tests**

Run: `npx vitest run tests/unit/agent/story-book-tool-contract.test.ts tests/unit/agent/deepagents-skill-schema.test.ts`

Expected: PASS.

- **Step 5: Commit the story-book contract rewrite**

```bash
git add backend/config/skills/story-book/SKILL.md backend/config/skills/story-book/config.yaml tests/unit/agent/story-book-tool-contract.test.ts
git commit -m "refactor: align story-book with domain image tools"
```

---

### Task 6: Final Verification Sweep

**Files:**

- Verify only; no new files unless failures require fixes
- **Step 1: Run all targeted unit tests introduced by this plan**

Run:

```bash
npx vitest run \
  tests/unit/application/agent/invoke-agent-use-case-explicit-step-results.test.ts \
  tests/unit/tools/shared-image-runners.test.ts \
  tests/unit/tools/generate-character-sheet.test.ts \
  tests/unit/tools/generate-storyboard-page.test.ts \
  tests/unit/agent/story-book-tool-contract.test.ts \
  tests/unit/services/tool-registration-names.test.ts \
  tests/unit/agent/deepagents-skill-schema.test.ts
```

Expected: PASS.

- **Step 2: Run the focused integration regressions**

Run:

```bash
npx vitest run \
  tests/integration/tools/split-grid-image.integration.test.ts \
  tests/integration/tools/generate-image.integration.test.ts
```

Expected: `split-grid-image.integration.test.ts` PASS.  
`generate-image.integration.test.ts` may SKIP when provider credentials are absent; treat SKIP as acceptable.

- **Step 3: Run lint on touched source files**

Run:

```bash
npx eslint \
  backend/application/agent/run-context.ts \
  backend/application/agent/invoke-agent-use-case.ts \
  backend/tools/generate-image.ts \
  backend/tools/edit-image.ts \
  backend/tools/split-grid-image.ts \
  backend/tools/generate-character-sheet.ts \
  backend/tools/generate-storyboard-page.ts \
  backend/tools/step-result-emitter.ts \
  src/providers/ChatProvider.tsx
```

Expected: PASS with no new lint errors.  
Note: `src/providers/ChatProvider.tsx` is included only as a regression guard because it consumes `agent:stepResult`.

- **Step 4: Review git diff before handoff**

Run: `git diff --stat && git diff`

Expected: only the planned files are changed, and there is no accidental frontend card work.

- **Step 5: Commit the final verification fixups if needed**

```bash
git add .
git commit -m "test: verify story-book image tool workflow"
```

Only create this commit if verification uncovered real code or test adjustments. If no files changed after verification, skip this commit.

---

## Execution Notes

- Keep the current frontend rendering model. Do not add new React card components for these tools in this implementation.
- For `generate_character_sheet`, delete `slot1~slot4` intermediate files after creating images named with the real role names so the workspace does not accumulate ambiguous role references.
- Treat explicit step results as the source of truth for wrapper tools. Regex extraction remains only as backward-compatible fallback for older tools.
- Do not widen scope into workflow manifest / resume-state redesign in this plan.

