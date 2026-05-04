# HITL Architecture

## Overview

This document describes the current Human-in-the-Loop action surface, where each action is configured, which backend tools invoke it, and how the frontend renders it.

## Configured Actions

| Action Type | Enabled | Require Approval | Priority | Current UI |
| --- | --- | --- | --- | --- |
| `file.delete` | `true` | `true` | `high` | Generic JSON or delete list |
| `file.write` | `false` | `false` | `low` | Not shown by default |
| `file.execute` | `true` | `true` | `high` | Generic JSON |
| `network.http` | `true` | `true` | `medium` | Generic JSON |
| `network.websocket` | `true` | `true` | `medium` | Generic JSON |
| `ai.text2image` | `true` | `true` | `low` | Custom prompt editor |
| `ai.text2speech` | `true` | `true` | `low` | Custom text list editor |
| `ai.vl_script` | `true` | `true` | `low` | Image preview plus editable user prompt |
| `ai.vl_caption_regions` | `true` | `true` | `low` | Image preview, subtitle context list, editable VL user prompt |
| `ai.image_caption_overlay` | `true` | `true` | `low` | Caption box editor (move/resize), read-only ruby, optional caption text edit |
| `ai.image_label_order` | `true` | `true` | `medium` | Interactive image annotation editor |
| `story.plan_review` | `true` | `true` | `medium` | Markdown review block |
| `system.command` | `true` | `true` | `high` | Generic JSON |
| `system.package.install` | `true` | `true` | `high` | Generic JSON |
| `data.export` | `true` | `true` | `high` | Generic JSON |
| `data.delete_batch` | `true` | `true` | `high` | Generic JSON |
| `artifacts.delete` | `true` | `true` | `high` | Delete file list |
| `ai.batch_tool_call` | `true` | `true` | `low` | Batch summary list |

## Current Tool Callsites

- `generate_image` -> `ai.text2image`
- `generate_audio` -> `ai.text2speech`
- `generate_script_from_image` -> `ai.vl_script`
- `suggest_caption_regions` -> `ai.vl_caption_regions`
- `compose_caption_overlay_on_image` -> `ai.image_caption_overlay`
- `annotate_image_with_numbers` -> `ai.image_label_order`
- `batch_tool_call` -> `ai.batch_tool_call`
- `delete_artifacts` -> `artifacts.delete`
- `edit_image` -> `ai.image_edit`
- `request_story_plan_review` -> `story.plan_review`

## Frontend Rendering

- Custom rendering: `ai.text2image`, `ai.text2speech`, `ai.vl_script`, `ai.vl_caption_regions`, `ai.image_caption_overlay`, `ai.image_label_order`, `artifacts.delete`, `story.plan_review`
- Batch rendering: payloads with `_batchMode` regardless of action type title
- Generic rendering: any other action type, including `file.delete`, `file.execute`, `network.http`, `system.command`, and `ai.image_edit`

## Notes

- `ai.image_edit` is currently invoked by a backend tool, but it is not listed in `backend/config/hitl-config.ts`; it therefore falls back to default HITL policy behavior and generic frontend rendering.
- Skill prompts and skill `config.yaml` files reference tool names, not HITL action names.

## Gap For story-book

`write_file` persists the Markdown file, but current HITL only confirms tool execution requests. There is no document-review action that renders Markdown and returns an approved or edited planning document.

## Target State For story-book

- Skill and skill `config.yaml` use the tool name `request_story_plan_review`
- Runtime policy, logging, and frontend rendering use the action name `story.plan_review`
- Payload: `filePath`, `title`, `markdownContent`, `reviewStage`, `allowEdit`, `confirmText`, `cancelText`
- UI: dedicated Markdown review block in `HitlConfirmBlock`
- Workflow: `write_file` -> `request_story_plan_review` -> optional `edit_file` -> continue