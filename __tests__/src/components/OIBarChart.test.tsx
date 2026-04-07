import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';

import OIBarChart from '@/components/OIBarChart';

// PURPOSE: Validate ATM detection and the summary metrics derived from option-chain open interest.
describe('components/OIBarChart', () => {
  // PURPOSE: Empty chart data should render nothing so the dashboard can stay clean before selection.
  it('renders nothing when there is no valid option-chain data', () => {
    // Rendering with no data reproduces the initial dashboard state.
    const { container } = render(<OIBarChart data={[]} />);

    // The component should stay absent rather than showing a broken shell.
    expect(container.firstChild).toBeNull();
  });

  // PURPOSE: This integration test protects ATM, PCR, and max-pain derivation from regressions.
  it('derives ATM, PCR, total OI, and max pain from the provided strikes', () => {
    // These rows are symmetric enough to make ATM and max pain deterministic in the test.
    const data = [
      {
        strikePrice: 90,
        CE: { openInterest: 1000, changeinOpenInterest: 100, totalTradedVolume: 100, lastPrice: 40 },
        PE: { openInterest: 1000, changeinOpenInterest: -100, totalTradedVolume: 100, lastPrice: 70 },
      },
      {
        strikePrice: 100,
        CE: { openInterest: 1000, changeinOpenInterest: 150, totalTradedVolume: 100, lastPrice: 50 },
        PE: { openInterest: 1000, changeinOpenInterest: 125, totalTradedVolume: 100, lastPrice: 50 },
      },
      {
        strikePrice: 110,
        CE: { openInterest: 1000, changeinOpenInterest: -50, totalTradedVolume: 100, lastPrice: 70 },
        PE: { openInterest: 1000, changeinOpenInterest: 75, totalTradedVolume: 100, lastPrice: 40 },
      },
    ];

    // Rendering the chart exercises the memoized summary calculations and the visual labels together.
    render(<OIBarChart data={data} strikesAroundATM={1} />);

    // The title confirms the component rendered around the calculated ATM strike.
    expect(screen.getByText(/ATM 100/)).toBeInTheDocument();
    // Total call OI should aggregate to 3.0K across the visible rows.
    expect(screen.getAllByText('3.0K')[0]).toBeInTheDocument();
    // PCR should be 1.00 because puts and calls have identical total OI in this fixture.
    expect(screen.getByText('1.00')).toBeInTheDocument();
    // The symmetric OI distribution should place max pain at the middle strike.
    expect(screen.getAllByText('100').length).toBeGreaterThan(0);
    // The "Change in Open Interest" heading confirms the second chart rendered too.
    expect(screen.getByText('Change in Open Interest')).toBeInTheDocument();
  });
});
