import { describe, it, expect } from 'vitest';
import {
  extractFirstImageUrlFromDashScopeChoicesRoot,
  extractFirstImageUrlFromDashScopeMessageContent,
} from '../../../backend/infrastructure/inference/dashscope-multimodal-image-url.js';

describe('dashscope-multimodal-image-url', () => {
  it('extracts first image from message content', () => {
    const url = extractFirstImageUrlFromDashScopeMessageContent([
      { type: 'text' },
      { image: 'https://example.com/a.png' },
    ]);
    expect(url).toBe('https://example.com/a.png');
  });

  it('extracts from choices root', () => {
    const url = extractFirstImageUrlFromDashScopeChoicesRoot({
      output: {
        choices: [
          {
            message: {
              content: [{ type: 'image', image: 'https://example.com/b.png' }],
            },
          },
        ],
      },
    });
    expect(url).toBe('https://example.com/b.png');
  });

  it('returns undefined when no image part', () => {
    expect(
      extractFirstImageUrlFromDashScopeChoicesRoot({
        output: {
          choices: [
            {
              message: {
                content: [{ type: 'text' }],
              },
            },
          ],
        },
      })
    ).toBeUndefined();
  });
});
