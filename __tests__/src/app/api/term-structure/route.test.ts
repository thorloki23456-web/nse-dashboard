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

describe('app/api/term-structure/route', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    jest.resetModules();
  });

  it('returns 400 when the symbol query parameter is missing', async () => {
    const { GET } = await import('@/app/api/term-structure/route');
    const response = await GET(new NextRequest('http://localhost/api/term-structure'));
    const payload = await response.json();

    expect(payload).toEqual({ error: 'Missing symbol' });
    expect(response.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 with a structured error when fewer than two expiries are available', async () => {
    const session = {
      get: jest.fn((url: string) => {
        if (url === 'https://www.nseindia.com/option-chain') {
          return Promise.resolve({
            headers: {
              'set-cookie': ['session=abc123'],
            },
          });
        }

        if (url === 'https://www.nseindia.com/api/option-chain-contract-info?symbol=NIFTY') {
          return Promise.resolve({
            data: {
              expiryDates: ['09-Apr-2026'],
            },
          });
        }

        throw new Error(`Unexpected URL: ${url}`);
      }),
    };

    mockCreate.mockReturnValue(session);
    const { GET } = await import('@/app/api/term-structure/route');
    const response = await GET(new NextRequest('http://localhost/api/term-structure?symbol=NIFTY'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      symbol: 'NIFTY',
      currentExpiryDate: '09-Apr-2026',
      nextExpiryDate: null,
      snapshot: null,
      result: null,
      error: 'At least two expiries are required for term structure analysis',
    });
  });

  it('returns current-week and next-week term structure output when both chains resolve', async () => {
    const session = {
      get: jest.fn((url: string) => {
        if (url === 'https://www.nseindia.com/option-chain') {
          return Promise.resolve({
            headers: {
              'set-cookie': ['session=abc123'],
            },
          });
        }

        if (url === 'https://www.nseindia.com/api/option-chain-contract-info?symbol=NIFTY') {
          return Promise.resolve({
            data: {
              expiryDates: ['09-Apr-2026', '16-Apr-2026'],
            },
          });
        }

        if (url.includes('expiry=09-Apr-2026')) {
          return Promise.resolve({
            data: {
              records: {
                data: [
                  {
                    strikePrice: 22000,
                    expiryDate: '09-Apr-2026',
                    CE: {
                      openInterest: 1000,
                      changeinOpenInterest: 50,
                      totalTradedVolume: 1500,
                      lastPrice: 120,
                      impliedVolatility: 22,
                    },
                    PE: {
                      openInterest: 1000,
                      changeinOpenInterest: -25,
                      totalTradedVolume: 1400,
                      lastPrice: 118,
                      impliedVolatility: 24,
                    },
                  },
                  {
                    strikePrice: 22300,
                    expiryDate: '09-Apr-2026',
                    CE: {
                      openInterest: 150,
                      changeinOpenInterest: 10,
                      totalTradedVolume: 400,
                      lastPrice: 40,
                      impliedVolatility: 18,
                    },
                    PE: {
                      openInterest: 150,
                      changeinOpenInterest: 8,
                      totalTradedVolume: 350,
                      lastPrice: 220,
                      impliedVolatility: 28,
                    },
                  },
                ],
                timestamp: '08-Apr-2026 10:00:00',
                underlyingValue: 22290,
              },
            },
          });
        }

        if (url.includes('expiry=16-Apr-2026')) {
          return Promise.resolve({
            data: {
              records: {
                data: [
                  {
                    strikePrice: 22000,
                    expiryDate: '16-Apr-2026',
                    CE: {
                      openInterest: 300,
                      changeinOpenInterest: 20,
                      totalTradedVolume: 700,
                      lastPrice: 150,
                      impliedVolatility: 19,
                    },
                    PE: {
                      openInterest: 300,
                      changeinOpenInterest: -15,
                      totalTradedVolume: 650,
                      lastPrice: 145,
                      impliedVolatility: 20,
                    },
                  },
                  {
                    strikePrice: 22300,
                    expiryDate: '16-Apr-2026',
                    CE: {
                      openInterest: 1800,
                      changeinOpenInterest: 90,
                      totalTradedVolume: 1700,
                      lastPrice: 95,
                      impliedVolatility: 16,
                    },
                    PE: {
                      openInterest: 1800,
                      changeinOpenInterest: 85,
                      totalTradedVolume: 1650,
                      lastPrice: 105,
                      impliedVolatility: 21,
                    },
                  },
                ],
                timestamp: '08-Apr-2026 10:00:00',
                underlyingValue: 22295,
              },
            },
          });
        }

        throw new Error(`Unexpected URL: ${url}`);
      }),
    };

    mockCreate.mockReturnValue(session);
    const { GET } = await import('@/app/api/term-structure/route');
    const response = await GET(new NextRequest('http://localhost/api/term-structure?symbol=NIFTY'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.symbol).toBe('NIFTY');
    expect(payload.currentExpiryDate).toBe('09-Apr-2026');
    expect(payload.nextExpiryDate).toBe('16-Apr-2026');
    expect(payload.snapshot).not.toBeNull();
    expect(payload.result).not.toBeNull();
    expect(payload.error).toBeNull();
    expect(payload.result.features.wallShift).toBe(300);
    expect(payload.result.recommendation.action).toBe('BUY_NEXT_WEEK_ATM');
  });

  it('returns a structured upstream error when one option-chain fetch fails', async () => {
    const session = {
      get: jest.fn((url: string) => {
        if (url === 'https://www.nseindia.com/option-chain') {
          return Promise.resolve({
            headers: {
              'set-cookie': ['session=abc123'],
            },
          });
        }

        if (url === 'https://www.nseindia.com/api/option-chain-contract-info?symbol=NIFTY') {
          return Promise.resolve({
            data: {
              expiryDates: ['09-Apr-2026', '16-Apr-2026'],
            },
          });
        }

        if (url.includes('expiry=09-Apr-2026')) {
          return Promise.resolve({
            data: {
              records: {
                data: [],
                timestamp: '08-Apr-2026 10:00:00',
                underlyingValue: 22120,
              },
            },
          });
        }

        if (url.includes('expiry=16-Apr-2026')) {
          return Promise.reject(new Error('upstream timeout'));
        }

        throw new Error(`Unexpected URL: ${url}`);
      }),
    };

    mockCreate.mockReturnValue(session);
    const { GET } = await import('@/app/api/term-structure/route');
    const response = await GET(new NextRequest('http://localhost/api/term-structure?symbol=NIFTY'));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      symbol: 'NIFTY',
      currentExpiryDate: '09-Apr-2026',
      nextExpiryDate: '16-Apr-2026',
      snapshot: null,
      result: null,
      error: 'Failed to fetch one or more option-chain payloads for weekly term structure',
    });
  });
});
