/** @jest-environment node */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';

import { NextRequest } from 'next/server';

const mockCreate = jest.fn();

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: mockCreate,
  },
}));

const makeCookieResponse = () => ({
  headers: {
    'set-cookie': ['nsit=abc123'],
  },
});

// PURPOSE: Validate candle aggregation, retry behavior, and the API contract consumed by the frontend.
describe('app/api/technical-analysis/route', () => {
  beforeEach(() => {
    // Each test needs a fresh axios session mock so call ordering stays deterministic.
    mockCreate.mockReset();
    // Resetting the module registry ensures each test imports the route after the axios mock is ready.
    jest.resetModules();
  });

  // PURPOSE: This verifies the route returns recentData and metadata fields instead of the broken data.data shape.
  it('aggregates ticks into candles and returns recentData, analysis, and metadata fields', async () => {
    // This mock session replaces outbound NSE calls so the route stays offline in tests.
    const session = {
      get: jest.fn()
        // The first request establishes the NSE session cookie.
        .mockResolvedValueOnce(makeCookieResponse())
        // The second request returns the tick stream used for candle aggregation.
        .mockResolvedValueOnce({
          data: {
            gpiData: [
              [Date.parse('2026-04-06T09:15:00Z'), 100],
              [Date.parse('2026-04-06T09:16:00Z'), 105],
              [Date.parse('2026-04-06T09:17:00Z'), 103],
              [Date.parse('2026-04-06T09:18:00Z'), 110],
              [Date.parse('2026-04-06T09:19:00Z'), 112],
              [Date.parse('2026-04-06T09:20:00Z'), 111],
            ],
          },
        }),
    };

    // The route under test creates its own axios session, so the factory must return our mock.
    mockCreate.mockReturnValue(session);
    // Importing after the mock is configured ensures the route uses the mocked axios module.
    const { GET } = await import('@/app/api/technical-analysis/route');

    // BANKNIFTY is mapped internally to the NSE index identifier NIFTY BANK.
    const request = new NextRequest('http://localhost/api/technical-analysis?symbol=BANKNIFTY&interval=3');
    // Calling the route directly lets us validate the real handler behavior.
    const response = await GET(request);
    // Parsing the JSON keeps the assertions focused on the actual API payload.
    const payload = await response.json();

    // The route should surface the mapped NSE index name as metadata.
    expect(payload.symbol).toBe('NIFTY BANK');
    // The response should preserve the requested candle interval.
    expect(payload.interval).toBe(3);
    // Six one-minute ticks across two three-minute buckets should produce two candles.
    expect(payload.candleCount).toBe(2);
    // The latest tick should be exposed as currentPrice for the UI cards.
    expect(payload.currentPrice).toBe(111);
    // The route should provide chart rows under recentData for the frontend table.
    expect(payload.recentData).toHaveLength(2);
    // The first bucket should aggregate open/high/low/close values correctly.
    expect(payload.recentData[0]).toEqual(
      expect.objectContaining({
        open: 100,
        high: 105,
        low: 100,
        close: 103,
      })
    );
    // The analysis object is the companion payload consumed by the signal UI.
    expect(payload.analysis).toEqual(
      expect.objectContaining({
        signal: expect.any(String),
        currentTrend: expect.any(String),
        currentRSI: expect.any(Number),
      })
    );
    // The real contract should not expose a nested data.data payload.
    expect(payload).not.toHaveProperty('data');
    // The chart URL must use the mapped and encoded NSE index name.
    expect(session.get).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('index=NIFTY%20BANK'),
      expect.objectContaining({
        headers: expect.objectContaining({
          cookie: 'nsit=abc123',
        }),
      })
    );
  });

  // PURPOSE: NSE commonly returns 401s after cookie expiry, so the route needs to refresh cookies and retry.
  it('retries the chart request after a 401 response', async () => {
    // This mock sequence reproduces a stale-cookie failure followed by a successful retry.
    const session = {
      get: jest.fn()
        // The first cookie fetch establishes the initial session.
        .mockResolvedValueOnce(makeCookieResponse())
        // The first chart request fails because the cookie is stale.
        .mockRejectedValueOnce({ response: { status: 401 } })
        // The route should refresh cookies before trying again.
        .mockResolvedValueOnce({
          headers: {
            'set-cookie': ['nsit=fresh456'],
          },
        })
        // The retry should succeed with a minimal tick payload.
        .mockResolvedValueOnce({
          data: {
            gpiData: [
              [Date.parse('2026-04-06T09:15:00Z'), 200],
              [Date.parse('2026-04-06T09:16:00Z'), 201],
            ],
          },
        }),
    };

    // Returning the mocked session ensures we observe the full retry sequence.
    mockCreate.mockReturnValue(session);
    // Importing after the mock is configured ensures the route uses the mocked axios module.
    const { GET } = await import('@/app/api/technical-analysis/route');

    // A default-friendly symbol keeps the focus on retry logic rather than mapping.
    const request = new NextRequest('http://localhost/api/technical-analysis?symbol=NIFTY&interval=3');
    // Running the handler should complete successfully after the retry.
    const response = await GET(request);
    // Parsing the body lets us verify the successful retry outcome.
    const payload = await response.json();

    // The handler should recover and still return a 200 response.
    expect(response.status).toBe(200);
    // The recovered payload should still expose the latest price.
    expect(payload.currentPrice).toBe(201);
    // The refreshed cookie should be used on the retry request.
    expect(session.get).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          cookie: 'nsit=fresh456',
        }),
      })
    );
  });

  // PURPOSE: Market-closed or empty-chart conditions should return a soft error payload instead of throwing.
  it('returns an empty-analysis payload when NSE provides no tick data', async () => {
    // This mock represents a valid HTTP response with no intraday points.
    const session = {
      get: jest.fn()
        // The session cookie request still needs to succeed.
        .mockResolvedValueOnce(makeCookieResponse())
        // The chart request resolves, but with an empty gpiData array.
        .mockResolvedValueOnce({
          data: {
            gpiData: [],
          },
        }),
    };

    // The route creates a session per request, so the factory must point to our mock.
    mockCreate.mockReturnValue(session);
    // Importing after the mock is configured ensures the route uses the mocked axios module.
    const { GET } = await import('@/app/api/technical-analysis/route');

    // The query is minimal because the empty-chart branch does not depend on special params.
    const request = new NextRequest('http://localhost/api/technical-analysis?symbol=NIFTY');
    // Calling the route directly lets us observe the graceful fallback payload.
    const response = await GET(request);
    // Parsing the payload makes the empty-state contract explicit.
    const payload = await response.json();

    // The route should return a human-readable empty-data message.
    expect(payload.error).toBe('No chart data available');
    // The fallback payload should keep the candle list empty.
    expect(payload.candles).toEqual([]);
    // The fallback payload should not fabricate an analysis object.
    expect(payload.analysis).toBeNull();
  });
});
