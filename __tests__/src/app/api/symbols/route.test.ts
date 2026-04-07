/** @jest-environment node */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockCreate = jest.fn();

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: mockCreate,
  },
}));

// PURPOSE: Validate the NSE symbol proxy contract and cookie forwarding behavior.
describe('app/api/symbols/route', () => {
  beforeEach(() => {
    // Resetting the factory keeps each axios session independent across tests.
    mockCreate.mockReset();
    // Resetting modules ensures each test imports the route after the axios mock is in place.
    jest.resetModules();
  });

  // PURPOSE: The route must establish an NSE session cookie before fetching the underlying-information API.
  it('fetches symbols through the cookie-backed NSE proxy flow', async () => {
    // The route uses one session instance, so both outbound requests are captured here.
    const session = {
      get: jest.fn()
        // The first request mimics the browser page hit that sets cookies.
        .mockResolvedValueOnce({
          headers: {
            'set-cookie': ['bm_sv=session123'],
          },
        })
        // The second request returns the cleaned symbol payload consumed by the page.
        .mockResolvedValueOnce({
          data: {
            IndexList: [{ symbol: 'NIFTY' }],
            UnderlyingList: [{ symbol: 'RELIANCE' }],
          },
        }),
    };

    // The axios factory should return our mocked session instance.
    mockCreate.mockReturnValue(session);
    // Importing after the mock setup ensures the route consumes the mocked axios module.
    const { GET } = await import('@/app/api/symbols/route');

    // Invoking the route directly keeps the test on the real handler code path.
    const response = await GET();
    // Parsing the JSON exposes the exact frontend payload shape.
    const payload = await response.json();

    // The route should surface the raw NSE payload for the page-level mapper.
    expect(payload).toEqual({
      IndexList: [{ symbol: 'NIFTY' }],
      UnderlyingList: [{ symbol: 'RELIANCE' }],
    });
    // The second request must carry the cookie acquired from the option-chain page.
    expect(session.get).toHaveBeenNthCalledWith(
      2,
      'https://www.nseindia.com/api/underlying-information',
      expect.objectContaining({
        headers: expect.objectContaining({
          cookie: 'bm_sv=session123',
        }),
      })
    );
  });

  // PURPOSE: Network failures should become a stable 500 JSON response instead of exploding in the route handler.
  it('returns a 500 error payload when NSE symbol fetching fails', async () => {
    // Throwing on the first request simulates DNS, timeout, or upstream outages.
    const session = {
      get: jest.fn().mockRejectedValue(new Error('upstream failed')),
    };

    // The axios factory should return our failing session instance.
    mockCreate.mockReturnValue(session);
    // Importing after the mock setup ensures the route consumes the mocked axios module.
    const { GET } = await import('@/app/api/symbols/route');

    // Calling the route should convert the thrown error into a JSON failure response.
    const response = await GET();
    // Parsing the payload makes the error contract explicit.
    const payload = await response.json();

    // The route should surface the expected error message to callers.
    expect(payload).toEqual({ error: 'Failed to fetch symbols' });
    // The route should mark the response as an upstream failure.
    expect(response.status).toBe(500);
  });
});
