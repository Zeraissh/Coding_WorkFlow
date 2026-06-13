import { describe, it, expect } from 'vitest';
import { cosineSimilarity } from '../src/core/embedder';

describe('cosineSimilarity', () => {
  it('is 1 for identical direction', () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 6);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it('is -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1, 6);
  });

  it('returns 0 for zero or mismatched-length vectors', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('ranks a closer vector higher', () => {
    const q = [1, 0, 0];
    const near = cosineSimilarity(q, [0.9, 0.1, 0]);
    const far = cosineSimilarity(q, [0.1, 0.9, 0]);
    expect(near).toBeGreaterThan(far);
  });
});
