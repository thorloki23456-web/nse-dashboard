import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';

import OptionAnalysis from '@/components/OptionAnalysis';

// PURPOSE: Validate strike classification and overall trend aggregation in the option-analysis widget.
describe('components/OptionAnalysis', () => {
  // PURPOSE: The widget should stay hidden until there is option-chain data to classify.
  it('renders nothing when no option data is available', () => {
    // Rendering with no data reproduces the initial dashboard state.
    const { container } = render(<OptionAnalysis data={[]} />);

    // The component should stay absent until there is data to analyze.
    expect(container.firstChild).toBeNull();
  });

  // PURPOSE: This protects the price-change/OI-change classification matrix from regressions.
  it('classifies strike activity and computes the overall trend summary', () => {
    // This fixture hits bullish, bearish, and neutral summary paths in one render.
    const data = [
      {
        strikePrice: 100,
        CE: {
          openInterest: 1000,
          changeinOpenInterest: 200,
          totalTradedVolume: 100,
          lastPrice: 50,
          change: 5,
          pChange: 0,
          impliedVolatility: 20,
        },
        PE: {
          openInterest: 1000,
          changeinOpenInterest: -100,
          totalTradedVolume: 100,
          lastPrice: 40,
          change: 4,
          pChange: 0,
          impliedVolatility: 20,
        },
      },
      {
        strikePrice: 110,
        CE: {
          openInterest: 1000,
          changeinOpenInterest: 0,
          totalTradedVolume: 100,
          lastPrice: 40,
          change: 0,
          pChange: 0,
          impliedVolatility: 20,
        },
        PE: {
          openInterest: 1000,
          changeinOpenInterest: -150,
          totalTradedVolume: 100,
          lastPrice: 50,
          change: -3,
          pChange: 0,
          impliedVolatility: 20,
        },
      },
    ];

    // Rendering with populated rows exercises both the summary cards and the per-strike table.
    render(<OptionAnalysis data={data} />);

    // Positive price and positive OI should classify as Long Buildup.
    expect(screen.getAllByText('Long Buildup').length).toBeGreaterThan(0);
    // Positive price and negative OI should classify as Short Covering.
    expect(screen.getAllByText('Short Covering').length).toBeGreaterThan(0);
    // Negative price and negative OI should classify as Long Liquidation.
    expect(screen.getAllByText('Long Liquidation').length).toBeGreaterThan(0);
    // Two bullish classifications versus one bearish classification should produce a bullish overall trend.
    expect(screen.getByText('Overall: BULLISH')).toBeInTheDocument();
  });
});
