import { OptionChain, SignalMetrics, ConfluenceRegime } from '../../lib/types';
import { TechnicalAnalysisResponse } from '../../app/api/technical-analysis/route';

/**
 * Core decision engine for Nifty 50 intraday options trading
 * Combines technical, sentiment, and options flow signals to choose CALL/PUT
 */

interface NiftySignalInput {
  price: number;
  technical: TechnicalAnalysisResponse;
  optionChain: OptionChain;
  metrics: SignalMetrics;
}

interface TradeDecision {
  recommendation: 'CALL' | 'PUT' | 'NEUTRAL';
  confidence: number; // 0.0 to 1.0
  rationale: string[];
  entryZone: { min: number; max: number };
  stopLoss: number;
  target: number;
}

interface SignalScore {
  name: string;
  score: number; // -1.0 to +1.0
  weight: number;
  explanation: string;
}

export class Nifty50IntradayEngine {
  private readonly config = {
    // Weights sum to 1.0 - adjusted based on historical regime performance
    weights: {
      technical: 0.35,
      oiSentiment: 0.30,
      volatility: 0.20,
      priceAction: 0.15,
    },
    // Nifty-specific thresholds
    thresholds: {
      overboughtRSI: 70,
      oversoldRSI: 30,
      highIV: 18,
      lowIV: 12,
      extremePCR: 1.3,
      lowPCR: 0.7,
    },
  };

  /**
   * Main decision method - determines whether to buy CALL or PUT
   */
  decide(input: NiftySignalInput): TradeDecision {
    const { price, technical, optionChain, metrics } = input;
    
    // Generate all signals with scores
    const signals = this.generateSignals(input);
    
    // Calculate weighted composite score
    const compositeScore = this.calculateCompositeScore(signals);
    
    // Determine recommendation based on score
    const { recommendation, confidence, rationale } = 
      this.interpretScore(compositeScore, signals, price);
    
    // Calculate key levels
    const atr = technical.indicators.find(i => i.name === 'ATR')?.value || 150;
    const volatilityFactor = metrics.impliedVolatility > this.config.thresholds.highIV ? 0.8 : 1.2;
    
    const baseRisk = atr * volatilityFactor;
    const entryBuffer = baseRisk * 0.3;
    
    return {
      recommendation,
      confidence,
      rationale,
      entryZone: {
        min: price - entryBuffer,
        max: price + entryBuffer,
      },
      stopLoss: recommendation === 'CALL' 
        ? price - baseRisk 
        : price + baseRisk,
      target: recommendation === 'CALL'
        ? price + (baseRisk * 1.5)
        : price - (baseRisk * 1.5),
    };
  }

  private generateSignals(input: NiftySignalInput): SignalScore[] {
    const { price, technical, optionChain, metrics } = input;
    const signals: SignalScore[] = [];

    // 1. Technical Signals (Trend & Momentum)
    const trendSignal = this.analyzeTechnicalSignals(technical);
    signals.push(trendSignal);

    // 2. OI Sentiment Signals (Smart Money Detection)
    const oiSignal = this.analyzeOISentiment(optionChain, metrics);
    signals.push(oiSignal);

    // 3. Volatility Regime Signals
    const volSignal = this.analyzeVolatilityRegime(metrics);
    signals.push(volSignal);

    // 4. Price Action Signals (Support/Resistance)
    const paSignal = this.analyzePriceAction(price, technical);
    signals.push(paSignal);

    return signals;
  }

  private analyzeTechnicalSignals(technical: TechnicalAnalysisResponse): SignalScore {
    const rsi = technical.indicators.find(i => i.name === 'RSI')?.value || 50;
    const macd = technical.indicators.find(i => i.name === 'MACD')?.value || 0;
    const signalLine = technical.indicators.find(i => i.name === 'MACD_SIGNAL')?.value || 0;
    const sma20 = technical.indicators.find(i => i.name === 'SMA_20')?.value || 0;
    const sma50 = technical.indicators.find(i => i.name === 'SMA_50')?.value || 0;
    
    let score = 0;
    const explanations: string[] = [];

    // RSI-based momentum
    if (rsi < this.config.thresholds.oversoldRSI) {
      score += 0.8;
      explanations.push("RSI oversold suggesting bullish reversal");
    } else if (rsi > this.config.thresholds.overboughtRSI) {
      score -= 0.8;
      explanations.push("RSI overbought suggesting bearish reversal");
    }

    // MACD crossover
    if (macd > signalLine) {
      score += 0.6;
      explanations.push("MACD bullish crossover");
    } else if (macd < signalLine) {
      score -= 0.6;
      explanations.push("MACD bearish crossover");
    }

    // Trend alignment
    if (sma20 > sma50) {
      score += 0.4;
      explanations.push("Uptrend: 20SMA > 50SMA");
    } else {
      score -= 0.4;
      explanations.push("Downtrend: 20SMA < 50SMA");
    }

    return {
      name: 'technical',
      score: Math.max(-1, Math.min(1, score / 2)), // Normalize to -1 to 1
      weight: this.config.weights.technical,
      explanation: explanations.join("; "),
    };
  }

  private analyzeOISentiment(optionChain: OptionChain, metrics: SignalMetrics): SignalScore {
    const { data, underlyingValue } = optionChain;
    const { pcr, oiImbalance, maxPainDistance } = metrics;
    
    let score = 0;
    const explanations: string[] = [];
    const atmStrike = this.findATMStrike(data, underlyingValue);

    // PCR Analysis
    if (pcr > this.config.thresholds.extremePCR) {
      score += 0.7; // High PCR = more puts = potential bottom
      explanations.push("Extreme PCR suggests oversold condition");
    } else if (pcr < this.config.thresholds.lowPCR) {
      score -= 0.7; // Low PCR = more calls = potential top
      explanations.push("Low PCR suggests overbought condition");
    }

    // OI Imbalance (Call OI vs Put OI)
    if (oiImbalance > 0.3) {
      score += 0.6; // More call OI buildup
      explanations.push("Call OI dominance suggests bullish sentiment");
    } else if (oiImbalance < -0.3) {
      score -= 0.6; // More put OI buildup
      explanations.push("Put OI dominance suggests bearish sentiment");
    }

    // Max Pain effect
    if (Math.abs(maxPainDistance) < 0.5) {
      // Price near max pain - expect mean reversion
      const maxPainBias = this.calculateMaxPainBias(data, underlyingValue);
      score += maxPainBias * 0.5;
      explanations.push("Price near max pain zone - mean reversion likely");
    }

    // Unusual OI changes at key strikes
    const unusualActivity = this.detectUnusualOIActivity(data, underlyingValue);
    if (unusualActivity.strongCalls) {
      score += 0.4;
      explanations.push("Unusual call writing at resistance");
    }
    if (unusualActivity.strongPuts) {
      score -= 0.4;
      explanations.push("Unusual put writing at support");
    }

    return {
      name: 'oiSentiment',
      score: Math.max(-1, Math.min(1, score / 2.2)),
      weight: this.config.weights.oiSentiment,
      explanation: explanations.join("; "),
    };
  }

  private analyzeVolatilityRegime(metrics: SignalMetrics): SignalScore {
    const { impliedVolatility, ivSkew, gex } = metrics;
    let score = 0;
    const explanations: string[] = [];

    // IV Level
    if (impliedVolatility > this.config.thresholds.highIV) {
      score -= 0.6; // High IV = expensive options, favor selling
      explanations.push("High IV favors put writing");
    } else if (impliedVolatility < this.config.thresholds.lowIV) {
      score += 0.6; // Low IV = cheap options, favor buying
      explanations.push("Low IV favors call buying");
    }

    // IV Skew (put vs call expensiveness)
    if (ivSkew > 0.1) {
      score -= 0.5; // Puts more expensive than calls
      explanations.push("Positive skew favors call buying");
    } else if (ivSkew < -0.1) {
      score += 0.5; // Calls more expensive than puts
      explanations.push("Negative skew favors put buying");
    }

    // Gamma Exposure effect
    if (gex > 1000000) {
      score += 0.4; // High positive GEX = market makers hedging long = support
      explanations.push("High GEX provides price support");
    } else if (gex < -1000000) {
      score -= 0.4; // High negative GEX = market makers hedging short = resistance
      explanations.push("Negative GEX creates price resistance");
    }

    return {
      name: 'volatility',
      score: Math.max(-1, Math.min(1, score / 1.5)),
      weight: this.config.weights.volatility,
      explanation: explanations.join("; "),
    };
  }

  private analyzePriceAction(price: number, technical: TechnicalAnalysisResponse): SignalScore {
    const support = technical.levels?.support?.[0] || 0;
    const resistance = technical.levels?.resistance?.[0] || 0;
    const volatility = technical.indicators.find(i => i.name === 'ATR')?.value || 150;
    
    let score = 0;
    const explanations: string[] = [];

    // Proximity to key levels
    const distToSupport = price - support;
    const distToResistance = resistance - price;

    if (distToSupport < volatility * 0.5) {
      score += 0.6;
      explanations.push("Near support level");
    } else if (distToResistance < volatility * 0.5) {
      score -= 0.6;
      explanations.push("Near resistance level");
    }

    // Breakout/breakdown detection
    const recentHigh = technical.indicators.find(i => i.name === 'HIGH_5')?.value || 0;
    const recentLow = technical.indicators.find(i => i.name === 'LOW_5')?.value || 0;

    if (price > resistance) {
      score += 0.5;
      explanations.push("Breaking above resistance");
    } else if (price < support) {
      score -= 0.5;
      explanations.push("Breaking below support");
    }

    // Momentum confirmation
    const close = technical.currentPrice || price;
    const open = technical.indicators.find(i => i.name === 'OPEN')?.value || price;
    
    if (close > open) {
      score += 0.3;
      explanations.push("Bullish candle pattern");
    } else {
      score -= 0.3;
      explanations.push("Bearish candle pattern");
    }

    return {
      name: 'priceAction',
      score: Math.max(-1, Math.min(1, score / 1.4)),
      weight: this.config.weights.priceAction,
      explanation: explanations.join("; "),
    };
  }

  private calculateCompositeScore(signals: SignalScore[]): number {
    return signals.reduce((total, signal) => {
      return total + (signal.score * signal.weight);
    }, 0);
  }

  private interpretScore(
    score: number, 
    signals: SignalScore[], 
    price: number
  ): Pick<TradeDecision, 'recommendation' | 'confidence' | 'rationale'> {
    const rationale = signals.map(s => `${s.name}: ${s.explanation}`).concat();
    
    // Higher threshold for entries - avoid weak signals
    if (score > 0.35) {
      return {
        recommendation: 'CALL',
        confidence: Math.min(0.95, score),
        rationale,
      };
    } else if (score < -0.35) {
      return {
        recommendation: 'PUT',
        confidence: Math.min(0.95, -score),
        rationale,
      };
    } else {
      return {
        recommendation: 'NEUTRAL',
        confidence: 1 - (Math.abs(score) / 0.35),
        rationale: [...rationale, "Composite score neutral - no clear edge"],
      };
    }
  }

  private findATMStrike(data: any[], price: number): any {
    return data.reduce((prev, curr) => {
      return (Math.abs(curr.strike - price) < Math.abs(prev.strike - price) ? curr : prev);
    });
  }

  private calculateMaxPainBias(data: any[], price: number): number {
    // Simplified: if max pain > price, bias = +1 (bullish)
    // if max pain < price, bias = -1 (bearish)
    const totalCallValue = data.reduce((sum, strike) => sum + (strike.strike > price ? strike.callOI * (strike.strike - price) : 0), 0);
    const totalPutValue = data.reduce((sum, strike) => sum + (strike.strike < price ? strike.putOI * (price - strike.strike) : 0), 0);
    
    return totalCallValue > totalPutValue ? 1 : -1;
  }

  private detectUnusualOIActivity(data: any[], price: number) {
    const atmWindow = 100; // ±100 points around ATM
    const strikesOfInterest = data.filter(s => Math.abs(s.strike - price) < atmWindow);
    
    let strongCalls = false;
    let strongPuts = false;

    // Look for unusual OI concentration
    const avgCallOI = strikesOfInterest.reduce((sum, s) => sum + (s.callOI || 0), 0) / strikesOfInterest.length;
    const avgPutOI = strikesOfInterest.reduce((sum, s) => sum + (s.putOI || 0), 0) / strikesOfInterest.length;

    strikesOfInterest.forEach(strike => {
      if (strike.callOI > avgCallOI * 2 && strike.strike > price) {
        strongCalls = true;
      }
      if (strike.putOI > avgPutOI * 2 && strike.strike < price) {
        strongPuts = true;
      }
    });

    return { strongCalls, strongPuts };
  }
}
