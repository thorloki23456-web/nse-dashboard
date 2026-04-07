import { describe, expect, it } from '@jest/globals';

import { blackScholesGreeks, blackScholesPrice } from '@/lib/greeks';

// PURPOSE: Validate the Black-Scholes helpers against known benchmark values and edge conditions.
describe('lib/greeks', () => {
  // PURPOSE: This benchmark guards the core pricing math that the option-chain table relies on client-side.
  it('computes benchmark call and put Greeks close to standard Black-Scholes reference values', () => {
    // This at-the-money setup is a well-known sanity-check input for Black-Scholes calculations.
    const callGreeks = blackScholesGreeks(100, 100, 1, 0.05, 0.2, true);
    // This matching put setup verifies the put branch rather than only the shared math path.
    const putGreeks = blackScholesGreeks(100, 100, 1, 0.05, 0.2, false);

    // Delta should match the expected call sensitivity for the benchmark input.
    expect(callGreeks.delta).toBeCloseTo(0.6368, 3);
    // Gamma should match the shared curvature term for both calls and puts.
    expect(callGreeks.gamma).toBeCloseTo(0.0188, 3);
    // Theta is daily decay, so the benchmark needs to confirm the daily conversion too.
    expect(callGreeks.theta).toBeCloseTo(-0.0176, 3);
    // Vega should be scaled per 1% IV move as implemented in the helper.
    expect(callGreeks.vega).toBeCloseTo(0.3752, 3);
    // Rho should match the expected interest-rate sensitivity for the call branch.
    expect(callGreeks.rho).toBeCloseTo(0.5323, 3);

    // Put delta should stay negative and match the known benchmark magnitude.
    expect(putGreeks.delta).toBeCloseTo(-0.3632, 3);
    // Gamma should remain identical across calls and puts for the same input set.
    expect(putGreeks.gamma).toBeCloseTo(callGreeks.gamma, 6);
    // Put theta should match the benchmark daily decay for the put branch.
    expect(putGreeks.theta).toBeCloseTo(-0.0045, 3);
    // Put vega should remain identical to call vega for the same contract terms.
    expect(putGreeks.vega).toBeCloseTo(callGreeks.vega, 6);
    // Put rho should be negative for an at-the-money put in this setup.
    expect(putGreeks.rho).toBeCloseTo(-0.4189, 3);
  });

  // PURPOSE: This protects the defensive branch used when the option has expired or the inputs are invalid.
  it('returns zero Greeks when time, volatility, or spot inputs are non-positive', () => {
    // Zero time to expiry should short-circuit to neutral Greeks instead of dividing by zero.
    expect(blackScholesGreeks(100, 100, 0, 0.05, 0.2, true)).toEqual({
      delta: 0,
      gamma: 0,
      theta: 0,
      vega: 0,
      rho: 0,
    });

    // Zero volatility should also avoid invalid logarithmic and square-root math.
    expect(blackScholesGreeks(100, 100, 1, 0.05, 0, true)).toEqual({
      delta: 0,
      gamma: 0,
      theta: 0,
      vega: 0,
      rho: 0,
    });

    // Non-positive spot prices should be treated as invalid market inputs.
    expect(blackScholesGreeks(0, 100, 1, 0.05, 0.2, true)).toEqual({
      delta: 0,
      gamma: 0,
      theta: 0,
      vega: 0,
      rho: 0,
    });
  });

  // PURPOSE: This ensures the price helper uses intrinsic value at expiry instead of the continuous-time formula.
  it('returns intrinsic value when the option is at or beyond expiry', () => {
    // Calls at expiry should collapse to max(spot - strike, 0).
    expect(blackScholesPrice(120, 100, 0, 0.05, 0.2, true)).toBe(20);
    // Puts at expiry should collapse to max(strike - spot, 0).
    expect(blackScholesPrice(80, 100, 0, 0.05, 0.2, false)).toBe(20);
    // Out-of-the-money options should be worthless at expiry.
    expect(blackScholesPrice(120, 100, 0, 0.05, 0.2, false)).toBe(0);
  });

  // PURPOSE: This guards the live pricing helper that the UI may use later for theoretical values.
  it('computes benchmark option prices close to reference Black-Scholes values', () => {
    // The same benchmark inputs keep the price and Greek tests aligned on one known contract.
    const callPrice = blackScholesPrice(100, 100, 1, 0.05, 0.2, true);
    // The matching put verifies the alternate payoff branch.
    const putPrice = blackScholesPrice(100, 100, 1, 0.05, 0.2, false);

    // The benchmark call price checks the normal CDF math and discounting.
    expect(callPrice).toBeCloseTo(10.4506, 3);
    // The benchmark put price checks parity-consistent discounting for puts.
    expect(putPrice).toBeCloseTo(5.5735, 3);
  });
});
