import { describe, expect, it } from '@jest/globals';

import type { OptionChainDiff } from '@/lib/types';

// PURPOSE: Keep the shared type contract visible in the test suite even though it is compile-time only.
describe('lib/types', () => {
  // PURPOSE: This test forces TypeScript to validate the exported shape used by diff-table consumers.
  it('accepts an OptionChainDiff object with the expected fields', () => {
    // This object mirrors the runtime shape expected by the diff table component.
    const sample: OptionChainDiff = {
      strike: 22100,
      ce_oi_diff: 1500,
      pe_oi_diff: -500,
      ce_vol_diff: 2000,
      pe_vol_diff: -1000,
    };

    // Reading the value at runtime keeps the test meaningful after type-checking succeeds.
    expect(sample.strike).toBe(22100);
  });
});
