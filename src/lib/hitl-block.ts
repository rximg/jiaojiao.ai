import type { HitlBlockRecord } from '@/types/types';

/** 是否为待确认（含消息内 pending；不含 Live 专用、无 hitl 行） */
export function isHitlPending(h: HitlBlockRecord | undefined): boolean {
  if (!h) return false;
  return h.status === 'pending';
}

/** 是否已决议（继续 / 未继续）；无 hitl 返回 undefined */
export function hitlResolvedView(
  h: HitlBlockRecord | undefined
): { approved: boolean } | undefined {
  if (!h) return undefined;
  if (h.status === 'pending') return undefined;
  if (h.status === 'approved' || h.status === 'rejected') {
    return { approved: h.status === 'approved' };
  }
  if (typeof h.approved === 'boolean') {
    return { approved: h.approved };
  }
  return undefined;
}
