import { describe, expect, it } from 'vitest';
import { DEFAULT_TOPOLOGY } from './topology';

describe('DEFAULT_TOPOLOGY', () => {
  it('keeps its generated triangle layout stable', () => {
    expect(DEFAULT_TOPOLOGY.triangles).toHaveLength(60);
    expect(DEFAULT_TOPOLOGY.triangles).toMatchSnapshot();
  });
});
