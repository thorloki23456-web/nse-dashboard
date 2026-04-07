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

// PURPOSE: Validate the expiry-date proxy flow, including request validation and 401 recovery.
describe('app/api/expiry-dates/route', () => {
  beforeEach(() => {
    // Resetting the factory keeps axios session behavior isolated per test.
    mockCreate.mockReset();
    // Resetting modules ensures the route is imported after the axios mock is configured.
    jest.resetModules();
  });

  // PURPOSE: The route should reject missing symbols before attempting any outbound network calls.
  it('returns 400 when the symbol query parameter is missing', async () => {
    // Importing the route after resetting modules keeps the handler fresh for this test.
    const { GET } = await import('@/app/api/expiry-dates/route');
    // A request without symbol reproduces the invalid frontend call path.
    const request = new NextRequest('http://localhost/api/expiry-dates');

    // Calling the handler should return early without touching axios.
    const response = await GET(request);
    // Parsing the response makes the validation contract explicit.
    const payload = await response.json();

    // The handler should explain what parameter is missing.
    expect(payload).toEqual({ error: 'Missing symbol' });
    // The status code should reflect a client-side validation issue.
    expect(response.status).toBe(400);
    // No outbound axios session should be created for an invalid request.
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // PURPOSE: This verifies the happy path where expiry dates come from the direct expiryDates field.
  it('returns expiry dates from the upstream contract', async () => {
    // The session mock captures the cookie bootstrap and the expiry lookup.
    const session = {
      get: jest.fn()
        // The first request sets the NSE cookies.
        .mockResolvedValueOnce({
          headers: {
            'set-cookie': ['session=abc123'],
          },
        })
        // The second request returns the direct expiryDates array.
        .mockResolvedValueOnce({
          data: {
            expiryDates: ['24-Apr-2026', '30-Apr-2026'],
          },
        }),
    };

    // The axios factory should return our mocked session instance.
    mockCreate.mockReturnValue(session);
    // Importing after the mock setup ensures the route consumes the mocked axios module.
    const { GET } = await import('@/app/api/expiry-dates/route');
    // A symbol query reproduces the page’s expiry lookup behavior.
    const request = new NextRequest('http://localhost/api/expiry-dates?symbol=NIFTY');

    // Calling the route should proxy and normalize the expiry payload.
    const response = await GET(request);
    // Parsing the JSON exposes the frontend-facing shape.
    const payload = await response.json();

    // The route should normalize the upstream payload to a simple expiryDates object.
    expect(payload).toEqual({
      expiryDates: ['24-Apr-2026', '30-Apr-2026'],
    });
    // The second request must carry the cookie acquired from the option-chain page.
    expect(session.get).toHaveBeenNthCalledWith(
      2,
      'https://www.nseindia.com/api/option-chain-contract-info?symbol=NIFTY',
      expect.objectContaining({
        headers: expect.objectContaining({
          cookie: 'session=abc123',
        }),
      })
    );
  });

  // PURPOSE: NSE often returns 401 after cookie expiry, so the route must refresh cookies and retry.
  it('retries on 401 and falls back to expiry dates nested inside records', async () => {
    // This sequence reproduces a stale cookie followed by a successful retry.
    const session = {
      get: jest.fn()
        // The first page request establishes the initial cookie.
        .mockResolvedValueOnce({
          headers: {
            'set-cookie': ['session=stale123'],
          },
        })
        // The first API request fails with a stale-cookie 401.
        .mockRejectedValueOnce({ response: { status: 401 } })
        // The route should refresh cookies before retrying.
        .mockResolvedValueOnce({
          headers: {
            'set-cookie': ['session=fresh456'],
          },
        })
        // The retry payload uses the alternate nested contract.
        .mockResolvedValueOnce({
          data: {
            records: {
              expiryDates: ['07-May-2026'],
            },
          },
        }),
    };

    // The axios factory should return our mocked session instance.
    mockCreate.mockReturnValue(session);
    // Importing after the mock setup ensures the route consumes the mocked axios module.
    const { GET } = await import('@/app/api/expiry-dates/route');
    // A symbol query reproduces the page’s expiry lookup behavior.
    const request = new NextRequest('http://localhost/api/expiry-dates?symbol=BANKNIFTY');

    // Calling the route should recover from the stale-cookie failure.
    const response = await GET(request);
    // Parsing the JSON exposes the normalized frontend payload.
    const payload = await response.json();

    // The retry should still return normalized expiry dates.
    expect(payload).toEqual({
      expiryDates: ['07-May-2026'],
    });
    // The final retry should carry the refreshed cookie rather than the stale one.
    expect(session.get).toHaveBeenLastCalledWith(
      'https://www.nseindia.com/api/option-chain-contract-info?symbol=BANKNIFTY',
      expect.objectContaining({
        headers: expect.objectContaining({
          cookie: 'session=fresh456',
        }),
      })
    );
  });
});
