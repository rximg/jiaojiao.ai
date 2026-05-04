/**
 * Tools 模块入口：导入所有工具以触发注册
 */
import './finalize-workflow.js';
import './annotate-image-with-numbers.js';
import './delete-artifacts.js';
import './generate-image.js';
import './edit-image.js';
import './split-grid-image.js';
import './generate-audio.js';
import './batch-tool-wrapper.js';
import './generate-script-from-image.js';
import './suggest-caption-regions.js';
import './compose-caption-overlay-on-image.js';
import './request-story-plan-review.js';

export { createTool, registerTool, getRegisteredToolNames } from './registry.js';
export type { ToolConfig, ToolContext } from './registry.js';
