import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';

import OptionChainDiffTable from '@/components/OptionChainDiffTable';

// PURPOSE: Validate the diff table both standalone and as a page-mounted refresh companion.
describe('components/OptionChainDiffTable', () => {
  // PURPOSE: Zero-delta rows should be filtered out so the table only shows meaningful changes.
  it('renders nothing when every diff row is zero', () => {
    // This fixture reproduces the no-op diff case.
    const { container } = render(
      <OptionChainDiffTable
        diffData={[
          {
            strike: 22000,
            ce_oi_diff: 0,
            pe_oi_diff: 0,
            ce_vol_diff: 0,
            pe_vol_diff: 0,
          },
        ]}
      />
    );

    // The component should stay absent when there are no meaningful changes to show.
    expect(container.firstChild).toBeNull();
  });

  // PURPOSE: This verifies the diff table keeps only non-zero rows and formats the deltas in thousands.
  it('renders non-zero OI and volume differences with formatted values', () => {
    // This fixture covers positive and negative formatting in the same row.
    render(
      <OptionChainDiffTable
        diffData={[
          {
            strike: 22000,
            ce_oi_diff: 1500,
            pe_oi_diff: -500,
            ce_vol_diff: 2000,
            pe_vol_diff: -1000,
          },
        ]}
      />
    );

    // The table title should explain what time-window delta the rows represent.
    expect(screen.getByText('OI & Volume Deltas (vs. last 15s)')).toBeInTheDocument();
    // Positive call OI deltas should be rendered with a +k suffix.
    expect(screen.getByText('+1.5k')).toBeInTheDocument();
    // Negative put OI deltas should preserve the negative sign and k suffix.
    expect(screen.getByText('-0.5k')).toBeInTheDocument();
    // The strike column should surface the associated strike price.
    expect(screen.getByText('22000')).toBeInTheDocument();
  });
});
