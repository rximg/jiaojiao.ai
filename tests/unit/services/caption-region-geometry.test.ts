import { describe, it, expect } from 'vitest';
import {
  defaultNormalizedCaptionRect,
  normalizedRectToPixelRect,
} from '../../../backend/services/caption-region-geometry.js';

describe('caption-region-geometry', () => {
  it('defaultNormalizedCaptionRect returns rects in 0–1 range', () => {
    const a = defaultNormalizedCaptionRect(0, 2);
    const b = defaultNormalizedCaptionRect(1, 2);
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.w).toBeLessThanOrEqual(1);
    expect(b.y).toBeLessThan(a.y);
  });

  it('normalizedRectToPixelRect scales and clamps to image', () => {
    const p = normalizedRectToPixelRect({ x: 0.1, y: 0.2, w: 0.5, h: 0.3 }, 1000, 800);
    expect(p.x).toBe(100);
    expect(p.y).toBe(160);
    expect(p.w).toBe(500);
    expect(p.h).toBe(240);
  });

  it('normalizedRectToPixelRect clamps box inside image', () => {
    const p = normalizedRectToPixelRect({ x: 0.95, y: 0.9, w: 0.5, h: 0.5 }, 200, 200);
    expect(p.x + p.w).toBeLessThanOrEqual(200);
    expect(p.y + p.h).toBeLessThanOrEqual(200);
    expect(p.w).toBeGreaterThanOrEqual(20);
    expect(p.h).toBeGreaterThanOrEqual(20);
  });
});
