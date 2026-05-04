import { describe, it, expect } from 'vitest';
import {
  buildCaptionOverlaySvg,
  DEFAULT_CAPTION_OVERLAY_STYLE,
} from '../../../backend/services/caption-overlay-render.js';

describe('caption-overlay-render', () => {
  it('buildCaptionOverlaySvg includes ruby reading and hanzi from items', () => {
    const svg = buildCaptionOverlaySvg(
      400,
      300,
      [
        {
          x: 10,
          y: 200,
          w: 380,
          h: 80,
          text: '宝。',
          items: [
            { char: '宝', reading: 'bǎo' },
            { char: '。', reading: '' },
          ],
        },
      ],
      DEFAULT_CAPTION_OVERLAY_STYLE
    );
    expect(svg).toContain('bǎo');
    expect(svg).toContain('宝');
    expect(svg).toContain('width="400"');
    expect(svg).toMatch(/fill="rgba\(255,255,255/);
  });
});
