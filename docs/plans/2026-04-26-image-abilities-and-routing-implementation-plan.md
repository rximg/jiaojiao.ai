# Image Abilities & Routing Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将图像能力配置从单一 `t2i` 拆分为 `t2i` + `image_edit`，并对齐 DashScope 的两类协议族（Qwen-Image/Qwen-Image-Edit 走同步 multimodal；wan2.6-t2i 走异步 image-generation + tasks），完成后以真实 API 集成测试拿到实际图片结果作为 G2 完成门禁。

**Architecture:** 配置层新增 `image_edit` ability；推理层保持“先抽象后实现”，同步与异步分别走统一基类/端口抽象，由 provider adapter 消化协议差异；工具层不堆 provider 分支。网关（G3）仅产出方案文档，不在本仓库实现。

**Tech Stack:** TypeScript（strict）、Vitest、Electron/Vite；DashScope HTTP（multimodal-generation 同步 + image-generation 异步 tasks）。

---

## Pre-flight（执行前必读）

**Specs to follow:**
- `docs/superpowers/specs/2026-04-26-image-routing-and-config-design.md`
- `docs/superpowers/specs/2026-04-26-jiaojiao-gateway-image-routing-design.md`（G3：仅方案）

**Docs to keep aligned while implementing:**
- `docs/third-party-api/dashscope-api.md`
- `docs/third-party-api/百炼万象2.6的图片编辑api.md`

**Commands (repo root):**
- Unit/integration: `npm run -s test:run`
- Inference integration: `npm run -s test:inference`
- DashScope real API (existing): `npm run -s test:inference:dashscope`
- Lint (optional): `npm run -s lint`

---

## Task 1: Add new ability key `image_edit` in domain types

**Files:**
- Modify: `backend/domain/inference/types.ts`

**Step 1: Write failing test (type-level / config contract)**

Create a minimal test that asserts `getAIConfig('image_edit')` works (will fail before implementation).

**Files:**
- Create: `tests/integration/inference/image-edit-config.integration.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { getAIConfig } from '../../../backend/infrastructure/inference/ai-config.js';

describe('Inference / getAIConfig / image_edit', () => {
  it('returns image_edit config block', async () => {
    const cfg = await getAIConfig('image_edit' as any);
    expect(cfg).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run -s test:run -- tests/integration/inference/image-edit-config.integration.test.ts`  
Expected: FAIL (unknown ability / type mismatch / runtime error)

**Step 3: Implement minimal type change**

- Add `'image_edit'` to `AIAbility`
- Add corresponding `ProviderAbilityMap` slot (it is mapped by `AIAbility`)

**Step 4: Re-run test**

Expected: Still FAIL (because `getAIConfig` doesn’t support it yet)

**Step 5: Commit**

Run:

```bash
git add backend/domain/inference/types.ts tests/integration/inference/image-edit-config.integration.test.ts
git commit -m "feat(inference): add image_edit ability key"
```

---

## Task 2: Extend `getAIConfig()` to support `image_edit`

**Files:**
- Modify: `backend/infrastructure/inference/ai-config.ts`
- Modify: `backend/config/ai_models.json` (add ability block)
- Modify: `tests/integration/inference/config.integration.test.ts` (update expectations)

**Step 1: Write failing test for config shape**

Add assertions that:
- `getAIConfig('image_edit')` returns `endpoint` + `model`
- `getAIConfig('t2i')` remains available

**Step 2: Run test to verify it fails**

Run: `npm run -s test:inference -- tests/integration/inference/config.integration.test.ts`  
Expected: FAIL (missing image_edit block / unknown ability)

**Step 3: Update config loader**

In `getAIConfig()` switch:
- Add `case 'image_edit'` similar to `t2i` (but semantically “sync multimodal” by default)
- Ensure provider selection still uses `agent.multimodalProvider`

**Step 4: Update `ai_models.json`**

Add `dashscope.image_edit` and `jiaojiao.image_edit` blocks:
- `default`: `qwen-image-edit-max*` (choose one concrete id present in models list)
- `endpoint`: `.../api/v1/services/aigc/multimodal-generation/generation`
- No `taskEndpoint` required for sync, but if the schema currently requires it, keep consistent or refactor type to allow optional taskEndpoint for sync abilities.

**Step 5: Update tests**

Update `tests/integration/inference/config.integration.test.ts` to assert:
- `t2i.default` is Qwen-Image family default (per your target policy)
- `image_edit.default` is Qwen-Image-Edit family default

**Step 6: Run tests**

Run: `npm run -s test:inference -- tests/integration/inference/config.integration.test.ts`  
Expected: PASS

**Step 7: Commit**

```bash
git add backend/infrastructure/inference/ai-config.ts backend/config/ai_models.json tests/integration/inference/config.integration.test.ts
git commit -m "feat(inference): split t2i and image_edit configs"
```

---

## Task 3: Wire `image_edit` config into port creation and `MultimodalPortImpl`

**Files:**
- Modify: `backend/infrastructure/repositories.ts`
- Modify: `backend/infrastructure/inference/multimodal-port-impl.ts`
- Modify: `backend/infrastructure/inference/create-ports.ts`
- Modify: `backend/domain/inference/types.ts` (if needed: add `ImageEditAIConfig` or reuse `T2IAIConfig` carefully)

**Step 1: Write failing integration test**

Update existing image-edit integration test to ensure it uses the `image_edit` config, not `t2i`.

**Step 2: Implement minimal injection**

- In `createMultimodalPort()` load both:
  - `getAIConfig('t2i')`
  - `getAIConfig('image_edit')`
- Create:
  - `t2iPort` from `t2iCfg`
  - `editImagePort` from `imageEditCfg`
- Update `MultimodalPortImplDeps` to include both configs separately (for tracing/metadata).

**Step 3: Run inference tests**

Run: `npm run -s test:inference -- tests/integration/inference/image-edit.integration.test.ts`  
Expected: PASS (or controlled failure if external quota/limit; mock where possible)

**Step 4: Commit**

```bash
git add backend/infrastructure/repositories.ts backend/infrastructure/inference/multimodal-port-impl.ts backend/infrastructure/inference/create-ports.ts
git commit -m "refactor(inference): inject image_edit config separately"
```

---

## Task 4: Enforce “abstract before implement” for sync vs async image calling

**Files:**
- Inspect existing: `backend/infrastructure/inference/bases/sync-inference-base.ts`
- Inspect existing: `backend/infrastructure/inference/bases/async-inference-base.ts`
- Modify only if missing capability boundaries required by spec

**Step 1: Audit**

Confirm there are stable base classes for:
- sync “execute”
- async “submit + poll”

**Step 2: If missing (only if truly missing), add minimal abstractions**

Do not add new layers unless required. Prefer reuse.

**Step 3: Commit (only if code changes were necessary)**

```bash
git add backend/infrastructure/inference/bases/*
git commit -m "refactor(inference): formalize sync/async base abstractions"
```

---

## Task 5 (G2): DashScope adapters — protocol-family correctness

**Files:**
- Modify: `backend/infrastructure/inference/adapters/t2i/dashscope.ts`
- Modify: `backend/infrastructure/inference/adapters/image-edit/dashscope.ts`
- Modify: `docs/third-party-api/dashscope-api.md` if any behavior differs

**Step 1: TDD — add focused unit tests**

Add unit tests for request body building and response parsing:
- T2I (Qwen-Image): sync multimodal response contains `output.choices[0].message.content[].image`
- Image-edit: requires 1~3 images; parsing image URL robust to missing `type`

**Step 2: Implement T2I sync multimodal for Qwen-Image**

- Ensure `t2i` uses `multimodal-generation/generation` when model is `qwen-image*`
- Ensure `wan2.6-t2i` uses `image-generation/generation` + tasks polling
- Keep error messages actionable (include HTTP status + body text)

**Step 3: Ensure image-edit reads from `image_edit` config**

- Endpoint: multimodal-generation
- Model default: qwen-image-edit-max*

**Step 4: Run unit tests**

Run: `npm run -s test:run`

**Step 5: Commit**

```bash
git add backend/infrastructure/inference/adapters/t2i/dashscope.ts backend/infrastructure/inference/adapters/image-edit/dashscope.ts tests/unit/
git commit -m "feat(dashscope): align qwen image generation/edit protocols"
```

---

## Task 6 (G2 Gate): Real API integration tests must return real images

**Files:**
- Modify/create: `tests/integration/inference/t2i.integration.test.ts`
- Modify/create: `tests/integration/inference/image-edit.integration.test.ts`

**Step 1: Ensure tests target Qwen-Image family**

- T2I test must use model `qwen-image*` and endpoint `multimodal-generation/generation`
- Image-edit test must use `qwen-image-edit*` and include a real image input (data URL from a small fixture file)

**Step 2: Run DashScope real API suite**

Run: `npm run -s test:inference:dashscope`  
Expected: PASS for:
- T2I returns a downloadable `image` URL
- Image edit returns a downloadable `image` URL

**Step 3: If failures are 429/FreeTierOnly**

- Add bounded retry/backoff in test harness (not in production code) or mark tests as “requires paid quota” in docs.
- The gate is still: when quota is available, the tests must pass without manual steps.

**Step 4: Commit**

```bash
git add tests/integration/inference/t2i.integration.test.ts tests/integration/inference/image-edit.integration.test.ts
git commit -m "test(inference): require real qwen image outputs"
```

---

## Task 7 (G3): No implementation in this repo — ensure plan + docs only

**Files:**
- None (code)
- Reference doc only: `docs/superpowers/specs/2026-04-26-jiaojiao-gateway-image-routing-design.md`

**Step 1: Confirm no gateway implementation changes are required here**

Keep gateway changes to the `jiaojiao-gateway` repository only.

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-04-26-image-abilities-and-routing-implementation-plan.md`.

Two execution options:

1. **Subagent-Driven (this session)** — dispatch per task, review between tasks  
2. **Parallel Session (separate)** — open new session with executing-plans, batch execution with checkpoints

Which approach?

