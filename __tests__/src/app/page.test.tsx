import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Home from '@/app/page';

let optionChainRequestCount = 0;
let termStructureRequestCount = 0;

// PURPOSE: Validate the dashboard page’s real fetch choreography and refresh-driven widgets together.
describe('app/page', () => {
  beforeEach(() => {
    // Fake timers let the test drive the 15-second option-chain refresh loop deterministically.
    jest.useFakeTimers();
    // Resetting the response counter keeps the first and second poll payloads predictable.
    optionChainRequestCount = 0;
    termStructureRequestCount = 0;
    // Replacing fetch keeps the page fully offline and deterministic in tests.
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      // Converting the request to a string makes URL routing easy inside the mock.
      const url = String(input);

      // The page first fetches the symbol universe on mount.
      if (url === '/api/symbols') {
        return {
          json: async () => ({
            data: {
              IndexList: [{ symbol: 'NIFTY' }],
              UnderlyingList: [{ symbol: 'RELIANCE' }],
            },
          }),
        } as Response;
      }

      // Selecting a symbol triggers the expiry-date lookup.
      if (url === '/api/expiry-dates?symbol=NIFTY') {
        return {
          json: async () => ({
            expiryDates: ['24-Apr-2026'],
          }),
        } as Response;
      }

      // Once expiry resolves, the page starts the live option-chain polling loop.
      if (url === '/api/option-chain?symbol=NIFTY&expiryDate=24-Apr-2026') {
        optionChainRequestCount += 1;
        const optionChainPayload = optionChainRequestCount === 1
          ? {
              data: [
                {
                  strikePrice: 22000,
                  expiryDate: '24-Apr-2026',
                  CE: {
                    openInterest: 1000,
                    changeinOpenInterest: 50,
                    totalTradedVolume: 1500,
                    lastPrice: 120,
                    change: 5,
                    pChange: 0.5,
                    impliedVolatility: 18,
                  },
                  PE: {
                    openInterest: 1100,
                    changeinOpenInterest: -25,
                    totalTradedVolume: 1400,
                    lastPrice: 118,
                    change: -4,
                    pChange: -0.4,
                    impliedVolatility: 19,
                  },
                },
              ],
              timestamp: '06-Apr-2026 15:29:59',
              underlyingValue: 22123.45,
            }
          : {
              data: [
                {
                  strikePrice: 22000,
                  expiryDate: '24-Apr-2026',
                  CE: {
                    openInterest: 1100,
                    changeinOpenInterest: 60,
                    totalTradedVolume: 1700,
                    lastPrice: 121,
                    change: 6,
                    pChange: 0.6,
                    impliedVolatility: 18,
                  },
                  PE: {
                    openInterest: 1050,
                    changeinOpenInterest: -40,
                    totalTradedVolume: 1300,
                    lastPrice: 117,
                    change: -5,
                    pChange: -0.5,
                    impliedVolatility: 19,
                  },
                },
              ],
              timestamp: '06-Apr-2026 15:30:14',
              underlyingValue: 22130.55,
            };

        return {
          json: async () => optionChainPayload,
        } as Response;
      }

      if (url === '/api/term-structure?symbol=NIFTY') {
        termStructureRequestCount += 1;

        return {
          json: async () => ({
            symbol: 'NIFTY',
            currentExpiryDate: '24-Apr-2026',
            nextExpiryDate: '01-May-2026',
            snapshot: null,
            result: {
              symbol: 'NIFTY',
              asOf: '2026-04-06T10:00:00.000Z',
              underlyingValue: 22123.45,
              daysToExpiry: 1,
              features: {
                atmTermSpread: 4.2,
                putSkewTransfer: -2.3,
                oiRollRatio: 1.7,
                wallShift: 200,
                pinVsBreakout: 320,
              },
              featureSignals: [
                {
                  feature: 'atmTermSpread',
                  rawValue: 4.2,
                  direction: 'NEUTRAL',
                  strength: 'MODERATE',
                  reason: 'Front-week IV is elevated but not yet directional.',
                },
                {
                  feature: 'putSkewTransfer',
                  rawValue: -2.3,
                  direction: 'BULLISH',
                  strength: 'STRONG',
                  reason: 'Hedging is not rolling into next week.',
                },
              ],
              confluence: {
                bullishCount: 3,
                bearishCount: 0,
                neutralCount: 1,
                pinCount: 1,
                dominantDirection: 'BULLISH',
                confluenceScore: 54,
              },
              recommendation: {
                action: 'BUY_NEXT_WEEK_ATM',
                direction: 'BULLISH',
                strength: 'MODERATE',
                rationale: ['OI is rolling forward.', 'Next-week wall is above this week.'],
                riskNote: 'Exit if the roll ratio reverses.',
                suggestedExpiry: 'NEXT_WEEK',
                suggestedStrike: 22200,
                confluenceScore: 54,
              },
            },
            error: null,
          }),
        } as Response;
      }

      // The technical-analysis widgets also request their shared backend route after symbol selection.
      if (url === '/api/technical-analysis?symbol=NIFTY&interval=3') {
        return {
          json: async () => ({
            analysis: {
              signal: 'NEUTRAL',
              signalReason: 'No crossover detected',
              currentTrend: 'none',
              currentRSI: 50,
              currentATR: 12,
              superTrendValue: 22100,
            },
            recentData: [
              {
                time: '09:15',
                open: 22100,
                high: 22120,
                low: 22090,
                close: 22100,
                atr: 12,
                superTrend: 22100,
                trend: 'none',
                rsi: 50,
              },
            ],
            currentPrice: 22100,
            candleCount: 1,
          }),
        } as Response;
      }

      // Throwing on unknown URLs keeps the page test strict about its fetch contract.
      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as jest.MockedFunction<typeof fetch>;
  });

  afterEach(() => {
    // Returning to real timers avoids leaking the fake clock into unrelated tests.
    jest.useRealTimers();
    // Clearing mocks avoids cross-test fetch call contamination.
    jest.clearAllMocks();
  });

  // PURPOSE: This end-to-end page test protects the symbols → expiry → option-chain refresh sequence.
  it('loads symbols, fetches expiries after selection, then polls option-chain data every 15 seconds', async () => {
    // The user-event helper needs access to the fake timer clock for async select interactions.
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    // Rendering the page exercises the real state machine across the dashboard widgets.
    render(<Home />);

    // Waiting for the NIFTY option ensures the initial symbol fetch and state update have both settled.
    await screen.findByRole('option', { name: 'NIFTY' });

    // Selecting NIFTY should trigger the expiry lookup effect.
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'NIFTY');

    // The expiry API should be called for the selected symbol.
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/expiry-dates?symbol=NIFTY');
    });

    // The page should automatically fetch option-chain data for the first expiry.
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/option-chain?symbol=NIFTY&expiryDate=24-Apr-2026');
    });
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/term-structure?symbol=NIFTY');
    });

    // The live table should surface the latest option-chain timestamp once data loads.
    expect(await screen.findByText('06-Apr-2026 15:29:59')).toBeInTheDocument();
    // The spot-price banner should display the returned underlying value.
    expect(screen.getByText('22,123.45')).toBeInTheDocument();
    // The option-chain row should include the returned strike price.
    expect(screen.getAllByText('22000').length).toBeGreaterThan(0);
    // The term-structure overlay should surface its recommendation once both expiries are compared.
    expect(await screen.findAllByText('BUY_NEXT_WEEK_ATM')).not.toHaveLength(0);

    // Advancing the fake clock should trigger the 15-second polling interval.
    await act(async () => {
      jest.advanceTimersByTime(15000);
    });

    // The page should call the option-chain endpoint again on the polling interval.
    await waitFor(() => {
      const optionChainCalls = (global.fetch as jest.Mock).mock.calls.filter(
        ([url]) => url === '/api/option-chain?symbol=NIFTY&expiryDate=24-Apr-2026'
      );

      expect(optionChainCalls).toHaveLength(2);
    });
    await waitFor(() => {
      const termStructureCalls = (global.fetch as jest.Mock).mock.calls.filter(
        ([url]) => url === '/api/term-structure?symbol=NIFTY'
      );

      expect(termStructureCalls).toHaveLength(2);
    });

    // The second poll should update the timestamp to the newer payload.
    expect(await screen.findByText('06-Apr-2026 15:30:14')).toBeInTheDocument();
    // The diff table should appear only after the refresh has a previous snapshot to compare against.
    expect(screen.getByText('OI & Volume Deltas (vs. last 15s)')).toBeInTheDocument();
    // The diff table should reflect the 100-contract call OI increase from the second payload.
    expect(screen.getAllByText('+0.1k').length).toBeGreaterThan(0);
    // The secondary overlay should keep polling with the live option-chain loop.
    expect(termStructureRequestCount).toBe(2);
  });
});
