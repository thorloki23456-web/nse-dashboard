/** @jest-environment node */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { NextRequest } from 'next/server';

const mockCreate = jest.fn();

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: mockCreate,
  },
}));

// PURPOSE: Validate the option-chain proxy flow, request validation, and retry logic.
describe('app/api/option-chain/route', () => {
  beforeEach(() => {
    // Resetting the factory keeps axios session behavior isolated per test.
    mockCreate.mockReset();
    // Resetting modules ensures the route is imported after the axios mock is configured.
    jest.resetModules();
  });

  // PURPOSE: The handler should reject incomplete queries before trying to call NSE.
  it('returns 400 when symbol or expiryDate is missing', async () => {
    // Importing after module reset keeps the route isolated for this test.
    const { GET } = await import('@/app/api/option-chain/route');
    // This request reproduces a malformed frontend query.
    const request = new NextRequest('http://localhost/api/option-chain?symbol=NIFTY');

    // The handler should return immediately for invalid input.
    const response = await GET(request);
    // Parsing the payload makes the validation contract explicit.
    const payload = await response.json();

    // The route should explain that both symbol and expiry are required.
    expect(payload).toEqual({ error: 'Missing symbol or expiryDate' });
    // The status code should reflect client-side validation failure.
    expect(response.status).toBe(400);
    // Invalid requests should not create an outbound axios session.
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // PURPOSE: Index symbols must map to the NSE "Indices" option-chain endpoint type.
  it('proxies index option-chain data and returns normalized fields', async () => {
    // The session mock captures the cookie bootstrap and the option-chain lookup.
    const session = {
      get: jest.fn()
        // The first request sets NSE cookies.
        .mockResolvedValueOnce({
          headers: {
            'set-cookie': ['session=index123'],
          },
        })
        // The second request returns a realistic option-chain contract payload.
        .mockResolvedValueOnce({
          data: {
            records: {
              data: [{ strikePrice: 22000 }],
              timestamp: '06-Apr-2026 15:29:59',
              underlyingValue: 22123.45,
            },
          },
        }),
    };

    // The axios factory should return our mocked session instance.
    mockCreate.mockReturnValue(session);
    // Importing after the mock setup ensures the route consumes the mocked axios module.
    const { GET } = await import('@/app/api/option-chain/route');
    // This request mirrors the page’s live option-chain lookup for an index.
    const request = new NextRequest('http://localhost/api/option-chain?symbol=NIFTY&expiryDate=24-Apr-2026');

    // Calling the route should proxy and normalize the option-chain payload.
    const response = await GET(request);
    // Parsing the JSON exposes the frontend-facing contract.
    const payload = await response.json();

    // The route should return the data array under the normalized key used by the page.
    expect(payload.data).toEqual([{ strikePrice: 22000 }]);
    // The timestamp should be preserved for the page header.
    expect(payload.timestamp).toBe('06-Apr-2026 15:29:59');
    // The underlying value should be preserved for the spot display and Greeks.
    expect(payload.underlyingValue).toBe(22123.45);
    // Index symbols must use type=Indices in the upstream request.
    expect(session.get).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('type=Indices'),
      expect.objectContaining({
        headers: expect.objectContaining({
          cookie: 'session=index123',
        }),
      })
    );
  });

  // PURPOSE: Equity symbols and stale-cookie retries need coverage because they use a different upstream type.
  it('retries on 401 and uses the Equity type for stock symbols', async () => {
    // This sequence reproduces a stale cookie followed by a successful retry.
    const session = {
      get: jest.fn()
        // The first page request establishes the initial cookie.
        .mockResolvedValueOnce({
          headers: {
            'set-cookie': ['session=stale123'],
          },
        })
        // The first option-chain request fails due to expired cookies.
        .mockRejectedValueOnce({ response: { status: 401 } })
        // The route should refresh cookies before retrying.
        .mockResolvedValueOnce({
          headers: {
            'set-cookie': ['session=fresh456'],
          },
        })
        // The retry returns a minimal but valid option-chain payload.
        .mockResolvedValueOnce({
          data: {
            records: {
              data: [{ strikePrice: 2500 }],
              timestamp: '06-Apr-2026 15:29:59',
              underlyingValue: 2512.1,
            },
          },
        }),
    };

    // The axios factory should return our mocked session instance.
    mockCreate.mockReturnValue(session);
    // Importing after the mock setup ensures the route consumes the mocked axios module.
    const { GET } = await import('@/app/api/option-chain/route');
    // This request mirrors the page’s live option-chain lookup for an equity symbol.
    const request = new NextRequest('http://localhost/api/option-chain?symbol=RELIANCE&expiryDate=24-Apr-2026');

    // Calling the route should recover from the stale-cookie failure.
    const response = await GET(request);
    // Parsing the JSON exposes the normalized frontend contract.
    const payload = await response.json();

    // The retry should still return the normalized data array.
    expect(payload.data).toEqual([{ strikePrice: 2500 }]);
    // The upstream request for a stock should use type=Equity.
    expect(session.get).toHaveBeenLastCalledWith(
      expect.stringContaining('type=Equity'),
      expect.objectContaining({
        headers: expect.objectContaining({
          cookie: 'session=fresh456',
        }),
      })
    );
    // The route should recover and return a successful status.
    expect(response.status).toBe(200);
  });
});
