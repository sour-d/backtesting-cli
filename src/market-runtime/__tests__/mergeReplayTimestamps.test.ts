import { describe, expect, it } from 'vitest';
import { mergeReplayTimestamps } from '../mergeReplayTimestamps.js';

describe('mergeReplayTimestamps', () => {
  it('returns sorted union of timestamps', () => {
    const a = new Map<number, unknown>([
      [100, {}],
      [300, {}],
    ]);
    const b = new Map<number, unknown>([
      [200, {}],
      [300, {}],
    ]);
    const merged = mergeReplayTimestamps(
      new Map([
        ['A', a],
        ['B', b],
      ]),
    );
    expect(merged).toEqual([100, 200, 300]);
  });
});
