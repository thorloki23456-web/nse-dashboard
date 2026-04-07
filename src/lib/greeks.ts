/**
 * Mathematical approximation of the Error Function `erf`
 * Abramowitz and Stegun approximation (formula 7.1.26)
 */
function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return sign * y;
}

/**
 * Standard Normal Cumulative Distribution Function
 */
function phi(x: number): number {
  return 0.5 * (1.0 + erf(x / Math.sqrt(2.0)));
}

/**
 * Standard Normal Probability Density Function
 */
function phi_pdf(x: number): number {
  return (1.0 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x);
}

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

/**
 * Computes Black-Scholes Greeks for an option.
 * 
 * @param S Current underlying price
 * @param K Option strike price
 * @param T Time to expiry in years
 * @param r Risk-free interest rate (decimal equivalent e.g., 0.10)
 * @param sigma Implied volatility (decimal equivalent e.g., 0.14)
 * @param isCall boolean True for Call, False for Put
 * @param q Continuous dividend yield (decimal form, default 0)
 * @returns Object with delta, gamma, theta, vega, rho
 */
export function blackScholesGreeks(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  isCall: boolean = true,
  q: number = 0.0
): Greeks {
  if (T <= 0 || sigma <= 0 || S <= 0) {
    return { delta: 0.0, gamma: 0.0, theta: 0.0, vega: 0.0, rho: 0.0 };
  }

  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  const eNegQT = Math.exp(-q * T);
  const eNegRT = Math.exp(-r * T);

  // Delta
  const delta = isCall 
    ? eNegQT * phi(d1) 
    : -eNegQT * phi(-d1);

  // Gamma (Same for both calls and puts)
  const gamma = (eNegQT * phi_pdf(d1)) / (S * sigma * Math.sqrt(T));

  // Theta (converted to daily decay by dividing by 365)
  const thetaCall = (
    (- (S * phi_pdf(d1) * sigma * eNegQT) / (2 * Math.sqrt(T))
    - r * K * eNegRT * phi(d2)
    + q * S * eNegQT * phi(d1))
  ) / 365.0;

  const thetaPut = (
    (- (S * phi_pdf(d1) * sigma * eNegQT) / (2 * Math.sqrt(T))
    + r * K * eNegRT * phi(-d2)
    - q * S * eNegQT * phi(-d1))
  ) / 365.0;

  const theta = isCall ? thetaCall : thetaPut;

  // Vega (1% change in implied volatility)
  const vega = S * eNegQT * phi_pdf(d1) * Math.sqrt(T) / 100;

  // Rho (1% change in risk-free interest rate)
  const rhoCall = K * T * eNegRT * phi(d2) / 100;
  const rhoPut = -K * T * eNegRT * phi(-d2) / 100;
  
  const rho = isCall ? rhoCall : rhoPut;

  return { delta, gamma, theta, vega, rho };
}

/**
 * Computes the theoretical option price using the Black-Scholes-Merton formula
 */
export function blackScholesPrice(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  isCall: boolean = true,
  q: number = 0.0
): number {
  if (T <= 0) {
    return isCall ? Math.max(0, S - K) : Math.max(0, K - S);
  }
  
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  
  const eNegQT = Math.exp(-q * T);
  const eNegRT = Math.exp(-r * T);
  
  if (isCall) {
    return (S * eNegQT * phi(d1)) - (K * eNegRT * phi(d2));
  } else {
    return (K * eNegRT * phi(-d2)) - (S * eNegQT * phi(-d1));
  }
}
