import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';

import TechnicalAnalysis from '@/components/TechnicalAnalysis';

// PURPOSE: Validate the TechnicalAnalysis widget’s API consumption and UI states.
describe('components/TechnicalAnalysis', () => {
  beforeEach(() => {
    // Replacing fetch keeps the component offline and fully deterministic in tests.
    global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;
  });

  afterEach(() => {
    // Clearing mocks avoids cross-test contamination of fetch call counts and payloads.
    jest.clearAllMocks();
  });

  // PURPOSE: The widget should stay hidden until the dashboard has a selected symbol.
  it('renders nothing when no symbol is selected', () => {
    // Rendering without a symbol reproduces the initial dashboard state.
    const { container } = render(<TechnicalAnalysis symbol="" />);

    // The component should stay absent until it has something to analyze.
    expect(container.firstChild).toBeNull();
  });

  // PURPOSE: This verifies the component consumes the technical-analysis route contract correctly.
  it('fetches technical-analysis data and renders the returned signal and table', async () => {
    // This payload mirrors the current route contract of analysis plus recentData metadata.
    (global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({
        analysis: {
          signal: 'BUY',
          signalReason: 'SuperTrend crossed UP ↑ | RSI=55 confirmed',
          currentTrend: 'up',
          currentRSI: 55,
          currentATR: 12.5,
          superTrendValue: 22050.5,
        },
        recentData: [
          {
            time: '09:15',
            open: 22000,
            high: 22040,
            low: 21990,
            close: 22020,
            atr: 12.5,
            superTrend: 22010,
            trend: 'up',
            rsi: 55,
          },
        ],
        currentPrice: 22100,
        candleCount: 12,
      }),
    });

    // Rendering with a symbol should trigger the analysis fetch on mount.
    render(<TechnicalAnalysis symbol="NIFTY" />);

    // The component should call the expected route with the fixed 3-minute interval.
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/technical-analysis?symbol=NIFTY&interval=3');
    });
    // The BUY signal should be rendered from the analysis payload.
    expect((await screen.findAllByText('BUY')).length).toBeGreaterThan(0);
    // The explanation text should come directly from the backend payload.
    expect(screen.getByText('SuperTrend crossed UP ↑ | RSI=55 confirmed')).toBeInTheDocument();
    // The recent-data heading confirms the component read the correct key from the API response.
    expect(screen.getByText(/Recent Candles with Indicators/)).toBeInTheDocument();
    // The current price card should display the latest price from the payload.
    expect(screen.getByText('22,100')).toBeInTheDocument();
  });

  // PURPOSE: Empty or market-closed responses should render the warning state instead of crashing.
  it('renders the API error message when the analysis payload is missing', async () => {
    // This payload mirrors the route’s graceful empty-data response branch.
    (global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({
        error: 'No chart data available',
        analysis: null,
      }),
    });

    // Rendering with a symbol should still call the route and then surface the warning.
    render(<TechnicalAnalysis symbol="NIFTY" />);

    // The warning should explain that the market may be closed or data is unavailable.
    expect(await screen.findByText(/No chart data available/)).toBeInTheDocument();
  });
});
