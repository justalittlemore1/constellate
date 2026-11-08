import { describe, expect, it } from 'vitest';
import { cooccurrence, linkWeight } from './index';

describe('brain weights', () => {
  it('weights semantic, co-occurrence and relation 0.5 / 0.3 / 0.2', () => {
    expect(linkWeight(1, 1, 1)).toBeCloseTo(1);
    expect(linkWeight(1, 0, 0)).toBeCloseTo(0.5);
    expect(linkWeight(2, -1, 0)).toBeCloseTo(0.5); // clamped
  });

  it('computes co-occurrence over conversation ids', () => {
    expect(cooccurrence(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3);
    expect(cooccurrence(new Set(), new Set())).toBe(0);
  });
});
