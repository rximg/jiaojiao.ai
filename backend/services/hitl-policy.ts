/**
 * HITL 策略决策（纯函数，便于单元测试）
 * 技术键：strict / allowlist / auto 对应「每次确认 / 按需确认 / 完全自动」
 */

export type HitlMode = 'auto' | 'allowlist' | 'strict';

const NEVER_AUTO_APPROVE_ACTIONS = new Set(['story.plan_review']);

/**
 * 判断给定 actionType 是否应自动通过（无需弹确认框）
 * @param mode 执行模式：auto=完全自动，allowlist=按需确认，strict=每次确认
 * @param allowlist 允许列表（actionType 集合），仅 allowlist 模式下生效
 * @param actionType 当前操作类型
 */
export function shouldAutoApprove(
  mode: HitlMode,
  allowlist: Set<string>,
  actionType: string
): boolean {
  if (NEVER_AUTO_APPROVE_ACTIONS.has(actionType)) return false;
  if (mode === 'auto') return true;
  if (mode === 'allowlist' && allowlist.has(actionType)) return true;
  return false;
}
