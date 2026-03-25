# Story Book HITL Plan Review Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a document-review HITL path for 《绘本故事策划稿.md》 so the story-book workflow writes the Markdown file first, pauses for human confirmation in a dedicated Markdown review block, and only continues after approval.

**Architecture:** Keep `write_file` as the persistence step and introduce a separate business HITL action, `story.plan_review`, instead of overloading `file.write`. Add a new skill-visible tool, `request_story_plan_review`, which internally invokes the runtime-owned `story.plan_review` action. Document the current HITL action surface in architecture docs, extend the frontend `HitlConfirmBlock` to render Markdown review content for that runtime action, and update the `story-book` skill to use the new review tool rather than echoing the full Markdown as normal assistant text.

**Tech Stack:** Electron IPC HITL flow, React 18 + TypeScript, `react-markdown`, LangChain tools, DeepAgents filesystem middleware, Vitest, ESLint.

---

### Task 1: Document The Current HITL Action Matrix

**Files:**
- Create: `docs/architecture/hitl.md`
- Read for reference: `backend/config/hitl-config.ts`
- Read for reference: `backend/tools/generate-image.ts`
- Read for reference: `backend/tools/generate-audio.ts`
- Read for reference: `backend/tools/generate-script-from-image.ts`
- Read for reference: `backend/tools/edit-image.ts`
- Read for reference: `backend/tools/annotate-image-with-numbers.ts`
- Read for reference: `backend/tools/batch-tool-wrapper.ts`
- Read for reference: `backend/tools/delete-artifacts.ts`
- Read for reference: `src/app/components/HitlConfirmBlock.tsx`

**Step 1: Draft the configured action table**

Write a Markdown table that lists every action defined in `backend/config/hitl-config.ts`, including whether it is enabled, whether it requires approval, and its current priority.

```md
| Action Type | Enabled | Require Approval | Priority | Current UI |
| --- | --- | --- | --- | --- |
| file.delete | true | true | high | generic JSON / delete list |
| file.write | false | false | low | not shown by default |
| ai.text2image | true | true | low | custom prompt editor |
```

**Step 2: Add the tool-callsite matrix**

Document which tools actually call `requestApprovalViaHITL`, so the doc distinguishes configured actions from actions that are truly exercised today.

```md
## Current tool callsites

- `generate_image` -> `ai.text2image`
- `generate_audio` -> `ai.text2speech`
- `generate_script_from_image` -> `ai.vl_script`
- `annotate_image_with_numbers` -> `ai.image_label_order`
- `batch_tool_call` -> `ai.batch_tool_call`
- `delete_artifacts` -> `artifacts.delete`
- `edit_image` -> `ai.image_edit` (note: custom UI missing today)
```

**Step 3: Add the frontend rendering matrix**

Document which action types have dedicated `HitlConfirmBlock` rendering branches and which fall back to generic JSON.

```md
## Frontend rendering

- Custom rendering: `ai.text2image`, `ai.text2speech`, `ai.vl_script`, `ai.image_label_order`, `artifacts.delete`, batch payloads with `_batchMode`
- Generic rendering: any other action type, including `ai.image_edit` today
```

**Step 4: Save the architecture note**

Save the doc as `docs/architecture/hitl.md` and end it with a short “Gap for story-book” section explaining why `file.write` cannot serve as the planning-document confirmation gate.

```md
## Gap for story-book

`write_file` persists the Markdown file, but current HITL only confirms tool execution requests. There is no document-review action that renders Markdown and returns an approved or edited planning document.
```

**Step 5: Verify the doc references the real action list**

Run: `rg "actionType: '|requestApprovalViaHITL\('|ACTION_TITLE" backend src docs/architecture/hitl.md`

Expected: output includes every action listed in the new doc and no undocumented custom-render branch.

**Step 6: Commit**

```bash
git add docs/architecture/hitl.md
git commit -m "docs: document current hitl actions"
```

### Task 2: Add A Dedicated Story Plan Review Action

**Files:**
- Modify: `backend/config/hitl-config.ts`
- Modify: `src/app/components/HitlConfirmBlock.tsx`
- Test: `backend/tests/story-plan-review-config.test.ts`

**Step 1: Write the failing config test**

Create a Vitest file that asserts the new action exists in the HITL config with approval enabled.

```ts
import { describe, expect, it } from 'vitest';
import { getHITLRule } from '../config/hitl-config.js';

describe('story.plan_review HITL rule', () => {
  it('requires manual approval', () => {
    const rule = getHITLRule('story.plan_review');
    expect(rule).toBeDefined();
    expect(rule?.enabled).toBe(true);
    expect(rule?.requireApproval).toBe(true);
    expect(rule?.priority).toBe('medium');
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npm run test:run -- backend/tests/story-plan-review-config.test.ts`

Expected: FAIL because `getHITLRule('story.plan_review')` is `undefined`.

**Step 3: Add the new HITL action rule**

Add this rule to `backend/config/hitl-config.ts` near the AI-generation and workflow review actions.

```ts
{
  actionType: 'story.plan_review',
  enabled: true,
  priority: 'medium',
  requireApproval: true,
  description: '绘本故事策划稿确认需要人工确认',
},
```

**Step 4: Add the new action title in the frontend**

Extend `ACTION_TITLE` so the review card shows business language instead of the generic title.

```ts
const ACTION_TITLE: Record<string, string> = {
  'story.plan_review': '确认绘本故事策划稿？',
  'ai.batch_tool_call': '批量执行工具？',
  'ai.text2image': '生成图像？',
  // ...existing items
};
```

**Step 5: Run the test to verify it passes**

Run: `npm run test:run -- backend/tests/story-plan-review-config.test.ts`

Expected: PASS with one test passing.

**Step 6: Commit**

```bash
git add backend/config/hitl-config.ts src/app/components/HitlConfirmBlock.tsx backend/tests/story-plan-review-config.test.ts
git commit -m "feat: add story plan review hitl action"
```

### Task 3: Create The Backend Review Tool

**Files:**
- Create: `backend/tools/request-story-plan-review.ts`
- Modify: `backend/tools/index.ts`
- Modify: `backend/config/skills/story-book/SKILL.md`
- Test: `backend/tests/request-story-plan-review.test.ts`

**Step 1: Write the failing tool test**

Create a Vitest file that verifies the tool passes Markdown content through HITL and returns merged review payload.

Note: the skill and `config.yaml` should reference the tool name `request_story_plan_review`; only runtime code and HITL docs should reference the action name `story.plan_review`.

```ts
import { describe, expect, it, vi } from 'vitest';
import { createTool } from '../tools/registry.js';
import '../tools/request-story-plan-review.js';

describe('request_story_plan_review tool', () => {
  it('returns merged markdown review payload from HITL', async () => {
    const requestApprovalViaHITL = vi.fn().mockResolvedValue({
      filePath: '绘本故事策划稿.md',
      title: '绘本故事策划稿',
      markdownContent: '# Edited',
      reviewStage: 'story_plan',
    });

    const tool = await createTool(
      'request_story_plan_review',
      {},
      {
        requestApprovalViaHITL,
        getDefaultSessionId: () => 'session-test',
      }
    );

    const result = await tool?.invoke({
      filePath: '绘本故事策划稿.md',
      title: '绘本故事策划稿',
      markdownContent: '# Original',
      reviewStage: 'story_plan',
    });

    expect(requestApprovalViaHITL).toHaveBeenCalledWith(
      'story.plan_review',
      expect.objectContaining({ markdownContent: '# Original' })
    );
    expect(String(result)).toContain('# Edited');
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npm run test:run -- backend/tests/request-story-plan-review.test.ts`

Expected: FAIL because the tool file is not registered yet.

**Step 3: Implement the new tool**

Create `backend/tools/request-story-plan-review.ts` and register `request_story_plan_review`.

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ToolConfig, ToolContext } from './registry.js';
import { registerTool } from './registry.js';

function create(config: ToolConfig, context: ToolContext) {
  return tool(
    async (params: {
      filePath: string;
      title?: string;
      markdownContent: string;
      reviewStage?: string;
      allowEdit?: boolean;
      confirmText?: string;
      cancelText?: string;
    }) => {
      const merged = await context.requestApprovalViaHITL('story.plan_review', {
        filePath: params.filePath,
        title: params.title ?? '绘本故事策划稿',
        markdownContent: params.markdownContent,
        reviewStage: params.reviewStage ?? 'story_plan',
        allowEdit: params.allowEdit ?? true,
        confirmText: params.confirmText ?? '确认策划稿',
        cancelText: params.cancelText ?? '退回修改',
      });

      return JSON.stringify({
        filePath: merged.filePath,
        title: merged.title,
        markdownContent: merged.markdownContent,
        reviewStage: merged.reviewStage,
        allowEdit: merged.allowEdit,
      });
    },
    {
      name: config.name ?? 'request_story_plan_review',
      description: config.description ?? '触发绘本故事策划稿的人工确认',
      schema: z.object({
        filePath: z.string(),
        title: z.string().optional(),
        markdownContent: z.string(),
        reviewStage: z.string().optional(),
        allowEdit: z.boolean().optional(),
        confirmText: z.string().optional(),
        cancelText: z.string().optional(),
      }),
    }
  );
}

registerTool('request_story_plan_review', create);
```

**Step 4: Register the tool module**

Add the import to `backend/tools/index.ts`.

```ts
import './request-story-plan-review.js';
```

**Step 5: Run the test to verify it passes**

Run: `npm run test:run -- backend/tests/request-story-plan-review.test.ts`

Expected: PASS with the HITL mock called once and the tool result containing the reviewed Markdown.

**Step 6: Commit**

```bash
git add backend/tools/request-story-plan-review.ts backend/tools/index.ts backend/tests/request-story-plan-review.test.ts
git commit -m "feat: add story plan review tool"
```

### Task 4: Render Markdown Review Content In HitlConfirmBlock

**Files:**
- Create: `src/app/components/MarkdownDocumentBlock.tsx`
- Modify: `src/app/components/HitlConfirmBlock.tsx`
- Modify: `src/app/components/ChatInterface.tsx`
- Read for reference: `src/app/components/ConfigDialog.tsx`

**Step 1: Create a reusable Markdown display block**

Create a small component that renders Markdown using `react-markdown` with the same link and typography conventions already used in `ConfigDialog`.

```tsx
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
      <div className="px-3 py-3 text-sm text-foreground prose prose-sm max-w-none">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </div>
  );
}
```

**Step 2: Add a `story.plan_review` render branch**

In `HitlConfirmBlock`, add a dedicated branch before the generic JSON fallback.

```tsx
if (request.actionType === 'story.plan_review') {
  const markdownContent = typeof payload.markdownContent === 'string' ? payload.markdownContent : '';
  const title = typeof payload.title === 'string' ? payload.title : '绘本故事策划稿';

  if (resolved) {
    return <MarkdownDocumentBlock content={markdownContent} title={title} />;
  }

  if (payload.allowEdit) {
    return (
      <EditableDocumentBlock
        value={editableMarkdownContent}
        onChange={setEditableMarkdownContent}
        title={title}
        placeholder="输入或编辑绘本故事策划稿 Markdown..."
        minRows={16}
      />
    );
  }

  return <MarkdownDocumentBlock content={markdownContent} title={title} />;
}
```

**Step 3: Wire edited Markdown into `handleContinue`**

Return the edited `markdownContent` when the user approves a `story.plan_review` request.

```tsx
if (request.actionType === 'story.plan_review' && !resolved) {
  const trimmed = editableMarkdownContent.trim();
  onContinue(trimmed ? { markdownContent: trimmed } : undefined);
  return;
}
```

**Step 4: Keep the pending card inline in the chat stream**

Verify `ChatInterface` needs no structural change beyond rendering the updated component; do not introduce a second modal or special dialog.

Run: `npm run lint -- src/app/components/HitlConfirmBlock.tsx src/app/components/MarkdownDocumentBlock.tsx`

Expected: no ESLint errors for the new action branch.

**Step 5: Manual UI verification**

Run: `npm run dev`

Expected:
- a pending `story.plan_review` request shows a Markdown review block
- the block supports edit-then-continue when `allowEdit` is `true`
- after approval, the historical message still renders the reviewed Markdown instead of raw JSON

**Step 6: Commit**

```bash
git add src/app/components/MarkdownDocumentBlock.tsx src/app/components/HitlConfirmBlock.tsx
git commit -m "feat: render markdown hitl review blocks"
```

### Task 5: Refactor The story-book Skill To Use The Review Tool

**Files:**
- Modify: `backend/config/skills/story-book/SKILL.md`
- Modify: `backend/config/skills/story-book/config.yaml`

**Step 1: Allow the new review tool in the skill**

Add `request_story_plan_review` to the `allowed-tools` list and keep `write_file` / `edit_file` intact. Do not add `story.plan_review` to the skill; action names remain runtime-only.

```yaml
allowed-tools:
  - write_file
  - edit_file
  - request_story_plan_review
  - write_todos
```

**Step 2: Replace the duplicate-Markdown instruction**

Rewrite Step 1 so it no longer says “在同一轮回复中直接以 Markdown 原文展示策划稿内容”.

```md
- 然后调用 `write_file` 将完整策划稿写入 workspace 根目录的 `绘本故事策划稿.md`。
- 写入完成后，立即调用 `request_story_plan_review`，由前端 HITL 以 Markdown 卡片展示策划稿供用户确认。
- 不要把完整策划稿作为普通 assistant 文本再次完整输出到聊天区。
```

**Step 3: Define the edit-after-review rule**

Add an explicit rule that if the HITL review returns edited Markdown, the agent must update the file before continuing.

```md
- 若 `request_story_plan_review` 返回的 `markdownContent` 与文件当前内容不同，必须立即调用 `edit_file` 回写 `绘本故事策划稿.md`。
- 只有在用户通过 HITL 明确确认后，才能将“确认策划稿并固定4角色设定”标记为 completed。
```

**Step 4: Update the tool-selection table**

Add a row for the new review tool. The table should mention the tool name, not the HITL action name.

```md
| 策划稿确认 | `request_story_plan_review` | 写入后触发 Markdown HITL 确认；若用户编辑则回写文件 |
```

**Step 5: Verify the skill text no longer instructs duplicate chat output**

Run: `rg "完整展示|Markdown 原文展示|request_story_plan_review|普通 assistant 文本" backend/config/skills/story-book/SKILL.md backend/config/skills/story-book/config.yaml`

Expected: the skill references `request_story_plan_review` and no longer requires a second full-text chat echo.

**Step 6: Commit**

```bash
git add backend/config/skills/story-book/SKILL.md backend/config/skills/story-book/config.yaml
git commit -m "refactor: gate story book planning with hitl review"
```

### Task 6: Final Verification And Documentation Refresh

**Files:**
- Modify: `docs/architecture/hitl.md`
- Verify: `backend/config/hitl-config.ts`
- Verify: `backend/tools/request-story-plan-review.ts`
- Verify: `src/app/components/HitlConfirmBlock.tsx`
- Verify: `backend/config/skills/story-book/SKILL.md`

**Step 1: Update the HITL doc with the new action**

Extend `docs/architecture/hitl.md` with a “Target state” section documenting `story.plan_review`, its payload shape, and its custom Markdown-render branch.

Also add a one-line note that skill prompts and skill `config.yaml` use `request_story_plan_review`, while `story.plan_review` is reserved for runtime policy, logging, and frontend HITL rendering.

```md
## Target state for story-book

- Action type: `story.plan_review`
- Payload: `filePath`, `title`, `markdownContent`, `reviewStage`, `allowEdit`, `confirmText`, `cancelText`
- UI: dedicated Markdown review block in `HitlConfirmBlock`
- Workflow: `write_file` -> `request_story_plan_review` -> optional `edit_file` -> continue
```

**Step 2: Run focused backend tests**

Run: `npm run test:run -- backend/tests/story-plan-review-config.test.ts backend/tests/request-story-plan-review.test.ts`

Expected: PASS with both test files green.

**Step 3: Run lint for touched implementation files**

Run: `npx eslint backend/config/hitl-config.ts backend/tools/request-story-plan-review.ts backend/config/skills/story-book/SKILL.md src/app/components/HitlConfirmBlock.tsx src/app/components/MarkdownDocumentBlock.tsx`

Expected: no lint errors in TypeScript files; Markdown path may be skipped if ESLint config ignores it.

**Step 4: Run an end-to-end manual check**

Run: `npm run dev`

Expected:
- story-book first writes `绘本故事策划稿.md`
- a `story.plan_review` HITL block appears instead of a duplicated assistant Markdown reply
- editing the Markdown in the HITL block updates the payload sent back to the agent
- after approval, downstream image and audio steps remain blocked until confirmation is complete

**Step 5: Capture the final diff and commit**

```bash
git add docs/architecture/hitl.md backend/config/hitl-config.ts backend/tools/request-story-plan-review.ts backend/tools/index.ts src/app/components/HitlConfirmBlock.tsx src/app/components/MarkdownDocumentBlock.tsx backend/config/skills/story-book/SKILL.md backend/config/skills/story-book/config.yaml backend/tests/story-plan-review-config.test.ts backend/tests/request-story-plan-review.test.ts
git commit -m "feat: add markdown hitl review for story book planning"
```