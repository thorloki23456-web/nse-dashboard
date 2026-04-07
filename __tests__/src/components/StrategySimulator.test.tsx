import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import StrategySimulator from '@/components/StrategySimulator';

const legacyMaBuyPrices = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6];
const rsiSellPrices = [...Array(50).fill(100), 97, 94, 91, 88, 85, 99, 113, 127];
const bollingerSellPrices = [...Array(20).fill(100), 80, 82, 85, 90, 100, 110, 120];
const breakoutSellPrices = [...Array(20).fill(100), 105, 110, 108, 90];

function toCandles(prices: number[]) {
  return prices.map((close) => ({ close }));
}

function getSignalPanel() {
  return screen.getByText('Live Algorithm Signal').parentElement as HTMLElement;
}

function getTradesCard() {
  return screen.getByText('Intraday Trades Hit').parentElement as HTMLElement;
}

function getSpotCard() {
  return screen.getByText('Current Spot Level').parentElement as HTMLElement;
}

// PURPOSE: Validate the strategy sandbox against the real route payload shapes and strategy branches.
describe('components/StrategySimulator', () => {
  beforeEach(() => {
    // Replacing fetch keeps the component offline and lets each test control the candle stream exactly.
    global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;
  });

  afterEach(() => {
    // Clearing mocks prevents one payload shape from leaking into the next strategy scenario.
    jest.clearAllMocks();
  });

  // PURPOSE: The widget should stay hidden until the page has selected a symbol.
  it('renders nothing when no symbol is selected', () => {
    // Rendering without a symbol reproduces the initial dashboard state.
    const { container } = render(<StrategySimulator symbol="" />);

    // The component should stay absent until it has a symbol to query.
    expect(container.firstChild).toBeNull();
  });

  // PURPOSE: This regression test verifies the component reads the current route contract from recentData.
  it('hydrates historical prices when the response includes recentData', async () => {
    // This payload matches the live technical-analysis route contract.
    (global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({
        recentData: [{ close: 100 }, { close: 105 }],
        currentPrice: 105,
      }),
    });

    // Rendering with a symbol should fetch historical prices on mount.
    render(<StrategySimulator symbol="NIFTY" />);

    // The component should query the technical-analysis endpoint with the fixed interval.
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/technical-analysis?symbol=NIFTY&interval=3');
    });
    // The evaluation count should match the two closes returned in the payload.
    expect(await screen.findByText('Eval: 2 candles')).toBeInTheDocument();
    // The spot level should reflect the final close in the recentData payload.
    expect(getSpotCard()).toHaveTextContent('105.00');
    // With only two closes, the default MA strategy should remain in HOLD.
    expect(getSignalPanel()).toHaveTextContent('HOLD');
  });

  // PURPOSE: This keeps the component tolerant of the older data.data payload while the route contract has moved on.
  it('still supports the legacy data.data fallback path', async () => {
    // This payload matches the older response shape the component used before the contract fix.
    (global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({
        data: toCandles(legacyMaBuyPrices),
      }),
    });

    // Rendering with a symbol should still trigger the technical-analysis fetch.
    render(<StrategySimulator symbol="NIFTY" />);

    // The legacy payload should still hydrate the full candle count for backtesting.
    expect(await screen.findByText(`Eval: ${legacyMaBuyPrices.length} candles`)).toBeInTheDocument();
    // The current spot card should still reflect the last close from the legacy payload.
    expect(getSpotCard()).toHaveTextContent('6.00');
    // The final candle should surface the real MA crossover BUY signal in the UI.
    expect(getSignalPanel()).toHaveTextContent('BUY');
  });

  // PURPOSE: RSI tab changes should render the RSI strategy title and its computed exit signal.
  it('renders the RSI strategy signal after switching tabs', async () => {
    // The user-event helper drives the real select element behavior.
    const user = userEvent.setup();
    // This candle series ends on the RSI strategy's sell condition using the component's default periods.
    (global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({
        recentData: toCandles(rsiSellPrices),
        currentPrice: rsiSellPrices[rsiSellPrices.length - 1],
      }),
    });

    // Rendering with a symbol starts on the MA strategy before the user switches tabs.
    render(<StrategySimulator symbol="NIFTY" />);

    // Waiting for the fetch ensures the price history is loaded before switching strategy tabs.
    expect(await screen.findByText(`Eval: ${rsiSellPrices.length} candles`)).toBeInTheDocument();

    // Switching to RSI exercises that strategy branch and its descriptive copy.
    await user.selectOptions(screen.getByRole('combobox'), 'RSI_MOMENTUM');

    // The RSI strategy title confirms the selected branch changed.
    expect(screen.getByText('RSI Momentum w/ EMA Trend Filter')).toBeInTheDocument();
    // The RSI scenario should render the computed SELL state on the live signal card.
    expect(getSignalPanel()).toHaveTextContent('SELL');
    // The buy-followed-by-sell sequence should register one completed trade.
    expect(getTradesCard()).toHaveTextContent('1');
  });

  // PURPOSE: Bollinger tab changes should render the mean-reversion label and its computed exit signal.
  it('renders the Bollinger strategy signal after switching tabs', async () => {
    // The user-event helper drives the real select element behavior.
    const user = userEvent.setup();
    // This candle series ends on the Bollinger strategy's upper-band exit using default settings.
    (global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({
        recentData: toCandles(bollingerSellPrices),
        currentPrice: bollingerSellPrices[bollingerSellPrices.length - 1],
      }),
    });

    // Rendering with a symbol starts on the default MA branch before the user switches tabs.
    render(<StrategySimulator symbol="NIFTY" />);

    // Waiting for candles ensures the selected strategy has history to evaluate.
    expect(await screen.findByText(`Eval: ${bollingerSellPrices.length} candles`)).toBeInTheDocument();

    // Switching to Bollinger exercises that branch of the strategy switch.
    await user.selectOptions(screen.getByRole('combobox'), 'BOLLINGER_REVERSION');

    // The Bollinger title confirms the correct strategy panel is active.
    expect(screen.getByText('Bollinger Bands Mean Reversion')).toBeInTheDocument();
    // The upper-band touch at the last candle should render the SELL signal.
    expect(getSignalPanel()).toHaveTextContent('SELL');
    // The completed mean-reversion cycle should count as one trade.
    expect(getTradesCard()).toHaveTextContent('1');
  });

  // PURPOSE: Breakout tab changes should render the breakout label and its computed exit signal.
  it('renders the Breakout strategy signal after switching tabs', async () => {
    // The user-event helper drives the real select element behavior.
    const user = userEvent.setup();
    // This candle series ends on the breakout strategy's support-break exit condition.
    (global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({
        recentData: toCandles(breakoutSellPrices),
        currentPrice: breakoutSellPrices[breakoutSellPrices.length - 1],
      }),
    });

    // Rendering with a symbol starts on the default MA branch before the user switches tabs.
    render(<StrategySimulator symbol="NIFTY" />);

    // Waiting for candles ensures the selected strategy has history to evaluate.
    expect(await screen.findByText(`Eval: ${breakoutSellPrices.length} candles`)).toBeInTheDocument();

    // Switching to Breakout exercises the final strategy branch.
    await user.selectOptions(screen.getByRole('combobox'), 'BREAKOUT');

    // The Breakout title confirms the correct strategy panel is active.
    expect(screen.getByText('Volatility Breakout (ATR Confirmed)')).toBeInTheDocument();
    // The support break at the final candle should render the SELL signal.
    expect(getSignalPanel()).toHaveTextContent('SELL');
    // The breakout entry and exit should count as one completed trade.
    expect(getTradesCard()).toHaveTextContent('1');
  });

  // PURPOSE: Even without candles, the backend currentPrice should still keep the spot card informative.
  it('renders the spot card from currentPrice when recentData is empty', async () => {
    // This payload reproduces a market snapshot with metadata but no candle rows.
    (global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({
        recentData: [],
        currentPrice: 12345,
      }),
    });

    // Rendering with a symbol should still call the technical-analysis endpoint.
    render(<StrategySimulator symbol="NIFTY" />);

    // Waiting for fetch invocation ensures the component left its initial synchronous render state.
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/technical-analysis?symbol=NIFTY&interval=3');
    });
    // The empty recentData array should keep the evaluation count at zero after the async fetch settles.
    expect(getSignalPanel()).toHaveTextContent('Eval: 0 candles');
    // The spot card should still surface the currentPrice fallback from the response.
    await waitFor(() => {
      expect(getSpotCard()).toHaveTextContent('12345.00');
    });
    // With no closes to process, the signal should remain HOLD.
    expect(getSignalPanel()).toHaveTextContent('HOLD');
  });
});
