import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, within } from '@testing-library/react';

import OptionChainTable from '@/components/OptionChainTable';
import { blackScholesGreeks } from '@/lib/greeks';

// PURPOSE: Validate the main option-chain table, including empty states and client-side Greek rendering.
describe('components/OptionChainTable', () => {
  beforeEach(() => {
    // Freezing time keeps the time-to-expiry Greek calculations deterministic.
    jest.useFakeTimers();
    // A one-year horizon makes the expected Greeks easy to compare against the benchmark helper.
    jest.setSystemTime(Date.parse('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    // Returning to real timers avoids leaking the frozen clock into unrelated tests.
    jest.useRealTimers();
  });

  // PURPOSE: The table should guide the user when no option-chain data has been loaded yet.
  it('renders the empty state when no rows are available', () => {
    // Rendering with no data reproduces the initial dashboard state.
    render(<OptionChainTable data={[]} />);

    // The empty-state title should explain why the table is blank.
    expect(screen.getByText('No option chain data available.')).toBeInTheDocument();
    // The helper text should tell the user what to do next.
    expect(screen.getByText('Select a symbol and expiry date above.')).toBeInTheDocument();
  });

  // PURPOSE: This verifies that the component wires the Greek helper output into the rendered cells.
  it('renders timestamp, spot price, and Greek values for a populated row', () => {
    // This one-year expiry keeps the time-to-expiry calculation equal to exactly one year.
    const data = [
      {
        strikePrice: 100,
        expiryDate: '2027-01-01T00:00:00Z',
        CE: {
          openInterest: 1000,
          changeinOpenInterest: 100,
          totalTradedVolume: 2000,
          lastPrice: 10.45,
          impliedVolatility: 20,
        },
        PE: {
          openInterest: 1500,
          changeinOpenInterest: -50,
          totalTradedVolume: 2200,
          lastPrice: 5.57,
          impliedVolatility: 20,
        },
      },
    ];
    // The component uses a fixed 10% risk-free rate in the Greek calculations.
    const callGreeks = blackScholesGreeks(100, 100, 1, 0.1, 0.2, true);
    // The put Greek values verify that both branches render in the same row.
    const putGreeks = blackScholesGreeks(100, 100, 1, 0.1, 0.2, false);

    // Rendering the table with populated data exercises the full per-row Greek path.
    render(
      <OptionChainTable
        data={data}
        timestamp="06-Apr-2026 15:29:59"
        underlyingValue={100}
      />
    );

    // The timestamp should be surfaced above the table for the refresh indicator.
    expect(screen.getByText('06-Apr-2026 15:29:59')).toBeInTheDocument();
    // The spot price should be surfaced above the table for context and Greek math.
    expect(screen.getAllByText('100').length).toBeGreaterThan(1);

    // The strike cell anchors the row-level assertions below.
    const strikeCell = screen.getAllByText('100').find((node) => node.tagName === 'TD');
    // The row lets us scope Greek lookups to the single rendered contract.
    const row = strikeCell?.closest('tr');

    // The row must exist for the remaining scoped assertions to be meaningful.
    expect(row).not.toBeNull();

    // The scoped row query verifies the call delta display.
    expect(within(row as HTMLElement).getByText(callGreeks.delta.toFixed(2))).toBeInTheDocument();
    // The scoped row query verifies the put delta display.
    expect(within(row as HTMLElement).getByText(putGreeks.delta.toFixed(2))).toBeInTheDocument();
    // The shared gamma value should appear twice because calls and puts share the same gamma.
    expect(within(row as HTMLElement).getAllByText(callGreeks.gamma.toFixed(4))).toHaveLength(2);
    // The scoped row query verifies the put theta display.
    expect(within(row as HTMLElement).getByText(putGreeks.theta.toFixed(2))).toBeInTheDocument();
  });
});
