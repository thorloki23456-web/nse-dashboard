// Helper Math Functions

export function calculateSMA(prices: number[], period: number): (number | null)[] {
  const sma: (number | null)[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      sma.push(null);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += prices[j];
      }
      sma.push(sum / period);
    }
  }
  return sma;
}

export function calculateEMA(prices: number[], period: number): (number | null)[] {
  const emaValues: (number | null)[] = [];
  const multiplier = 2 / (period + 1);
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      emaValues.push(null);
    } else if (i === period - 1) {
      // First EMA is SMA
      let sum = 0;
      for (let j = 0; j <= i; j++) {
        sum += prices[j];
      }
      emaValues.push(sum / period);
    } else {
      const currentPrice = prices[i];
      const prevEma = emaValues[i - 1]!;
      const ema = (currentPrice - prevEma) * multiplier + prevEma;
      emaValues.push(ema);
    }
  }
  return emaValues;
}

export function calculateRSI(prices: number[], period: number = 14): number[] {
  const rsiValues: number[] = [];
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period) {
      rsiValues.push(50); // Neutral RSI until period reached
      continue;
    }
    
    let sumGain = 0;
    let sumLoss = 0;
    
    for (let j = i - period + 1; j <= i; j++) {
      const change = prices[j] - prices[j - 1];
      if (change > 0) sumGain += change;
      else sumLoss += Math.abs(change);
    }
    
    const avgGain = sumGain / period;
    const avgLoss = sumLoss / period;
    
    if (avgLoss === 0) {
      rsiValues.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsiValues.push(100 - (100 / (1 + rs)));
    }
  }
  return rsiValues;
}

export function calculateBollingerBands(prices: number[], window: number, numStdDev: number) {
  const upperBand: (number | null)[] = [];
  const lowerBand: (number | null)[] = [];
  const sma = calculateSMA(prices, window);
  
  for (let i = 0; i < prices.length; i++) {
    if (i < window - 1 || sma[i] === null) {
      upperBand.push(null);
      lowerBand.push(null);
    } else {
      // Calculate Standard Deviation
      let variance = 0;
      const mean = sma[i]!;
      for (let j = i - window + 1; j <= i; j++) {
        variance += Math.pow(prices[j] - mean, 2);
      }
      variance /= window;
      const stdDev = Math.sqrt(variance);
      
      upperBand.push(mean + stdDev * numStdDev);
      lowerBand.push(mean - stdDev * numStdDev);
    }
  }
  
  return { upperBand, lowerBand };
}

export function findSupportResistance(prices: number[], window: number = 20) {
  const supportLvl: number[] = [];
  const resistanceLvl: number[] = [];
  
  for (let i = 0; i < prices.length; i++) {
    if (i < window) {
      const slice = prices.slice(0, i + 1);
      supportLvl.push(Math.min(...slice));
      resistanceLvl.push(Math.max(...slice));
    } else {
      const slice = prices.slice(i - window, i); // up to previous price matching Python implementation
      supportLvl.push(Math.min(...slice));
      resistanceLvl.push(Math.max(...slice));
    }
  }
  return { supportLvl, resistanceLvl };
}

export function calculateATR(prices: number[], period: number = 14): number[] {
  const atrValues: number[] = [];
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period) {
      atrValues.push(0);
      continue;
    }
    
    const ranges: number[] = [];
    for (let j = i - period + 1; j <= i; j++) {
      if (j > 0) {
        // Simplified true range using close prices
        ranges.push(Math.abs(prices[j] - prices[j-1]));
      }
    }
    
    const atr = ranges.reduce((a, b) => a + b, 0) / ranges.length;
    atrValues.push(atr);
  }
  return atrValues;
}

// ---------------------------------------------------------
// Trading Strategy Algorithms
// These functions map an array of prices to an array of signals
// 1 = BUY, -1 = SELL, 0 = HOLD
// ---------------------------------------------------------

export function generateMACrossover(prices: number[], fastPeriod: number = 5, slowPeriod: number = 10): number[] {
  const fastMa = calculateSMA(prices, fastPeriod);
  const slowMa = calculateSMA(prices, slowPeriod);
  const signals: number[] = [];
  let position = 0;
  
  for (let i = 0; i < prices.length; i++) {
    if (fastMa[i] === null || slowMa[i] === null || i === 0) {
      signals.push(0);
      continue;
    }
    
    const prevFast = fastMa[i - 1]!;
    const prevSlow = slowMa[i - 1]!;
    const curFast = fastMa[i]!;
    const curSlow = slowMa[i]!;
    
    // BUY: fast MA crosses above slow MA
    if (prevFast <= prevSlow && curFast > curSlow && position === 0) {
      signals.push(1);
      position = 1;
    } 
    // SELL: fast MA crosses below slow MA
    else if (prevFast >= prevSlow && curFast < curSlow && position === 1) {
      signals.push(-1);
      position = 0;
    } 
    else {
      signals.push(0);
    }
  }
  return signals;
}

export function generateRSIMomentum(prices: number[], rsiPeriod: number = 14, emaPeriod: number = 50): number[] {
  const rsi = calculateRSI(prices, rsiPeriod);
  const ema = calculateEMA(prices, emaPeriod);
  const signals: number[] = [];
  let position = 0;
  let prevRsi = 50;
  
  for (let i = 0; i < prices.length; i++) {
    const currentRsi = rsi[i];
    const currentPrice = prices[i];
    const currentEma = ema[i];
    
    if (currentEma === null) {
      signals.push(0);
      prevRsi = currentRsi;
      continue;
    }
    
    // BUY: RSI crosses above 30, price > EMA
    if (prevRsi < 30 && currentRsi >= 30 && currentPrice > currentEma && position === 0) {
      signals.push(1);
      position = 1;
    } 
    // SELL: RSI > 70 OR price drops below EMA
    else if (position === 1 && (currentRsi > 70 || currentPrice < currentEma)) {
      signals.push(-1);
      position = 0;
    } 
    else {
      signals.push(0);
    }
    
    prevRsi = currentRsi;
  }
  return signals;
}

export function generateBollingerMeanReversion(prices: number[], window: number = 20, numStdDev: number = 2): number[] {
  const { upperBand, lowerBand } = calculateBollingerBands(prices, window, numStdDev);
  const signals: number[] = [];
  let position = 0;
  
  for (let i = 0; i < prices.length; i++) {
    const price = prices[i];
    const lower = lowerBand[i];
    const upper = upperBand[i];
    
    if (lower === null || upper === null) {
      signals.push(0);
      continue;
    }
    
    if (price < lower && position === 0) {
      signals.push(1);
      position = 1;
    } else if (price > upper && position === 1) {
      signals.push(-1);
      position = 0;
    } else {
      signals.push(0);
    }
  }
  return signals;
}

export function generateVolatilityBreakout(prices: number[], window: number = 20, atrPeriod: number = 14): number[] {
  const { supportLvl, resistanceLvl } = findSupportResistance(prices, window);
  const atr = calculateATR(prices, atrPeriod);
  const signals: number[] = [];
  let position = 0;
  
  for (let i = 0; i < prices.length; i++) {
    if (i < 20) {
      signals.push(0);
      continue;
    }
    
    const price = prices[i];
    // Use previous timeframe support/resistance levels
    const resistance = resistanceLvl[i - 1];
    const support = supportLvl[i - 1];
    const currentAtr = atr[i];
    
    const momentum = Math.abs(price - prices[i - 1]);
    const highVolume = currentAtr > 0 ? (momentum > (currentAtr * 0.5)) : false;
    
    if (price > resistance && highVolume && position === 0) {
      signals.push(1);
      position = 1;
    } else if (position === 1 && price < support) {
      // Note: We leave the "3% profit target" exit logic to be handled 
      // dynamically by the execution engine, since it requires entry price state.
      signals.push(-1);
      position = 0;
    } else {
      signals.push(0);
    }
  }
  return signals;
}
