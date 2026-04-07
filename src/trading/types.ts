// ─── Core domain types shared across all trading modules ───────────────────

export type Side = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
export type OrderStatus = 'PENDING' | 'OPEN' | 'FILLED' | 'PARTIAL' | 'CANCELLED' | 'REJECTED';
export type SignalKind = 'MOMENTUM' | 'MEAN_REVERSION' | 'BREAKOUT' | 'GAMMA_SCALP' | 'UOA' | 'CONFLUENCE';
export type RiskEvent = 'MAX_DRAWDOWN' | 'DAILY_LOSS' | 'POSITION_LIMIT' | 'VPIN_TOXIC' | 'MARGIN_BREACH';

// ─── Market data ────────────────────────────────────────────────────────────

export interface Candle {
  ts: number;       // unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Tick {
  ts: number;
  symbol: string;
  ltp: number;
  bid: number;
  ask: number;
  volume: number;
}

// ─── Signals ────────────────────────────────────────────────────────────────

export interface Signal {
  id: string;
  ts: number;
  symbol: string;
  kind: SignalKind;
  side: Side;
  strength: number;       // 0–100
  confidence: number;     // 0–100
  suggestedEntry: number;
  suggestedStop: number;
  suggestedTarget: number;
  meta: Record<string, unknown>;
}

// ─── Orders ─────────────────────────────────────────────────────────────────

export interface Order {
  id: string;
  signalId: string;
  symbol: string;
  side: Side;
  type: OrderType;
  qty: number;
  limitPrice?: number;
  stopPrice?: number;
  status: OrderStatus;
  filledQty: number;
  avgFillPrice: number;
  slippage: number;
  createdAt: number;
  updatedAt: number;
}

export interface Fill {
  orderId: string;
  qty: number;
  price: number;
  ts: number;
  latencyMs: number;
}

// ─── Positions ───────────────────────────────────────────────────────────────

export interface Position {
  symbol: string;
  qty: number;          // negative = short
  avgCost: number;
  unrealisedPnl: number;
  realisedPnl: number;
  openedAt: number;
}

// ─── Portfolio ───────────────────────────────────────────────────────────────

export interface PortfolioSnapshot {
  ts: number;
  cash: number;
  equity: number;       // cash + unrealised
  positions: Position[];
  dailyPnl: number;
  totalPnl: number;
}

// ─── Risk ────────────────────────────────────────────────────────────────────

export interface RiskConfig {
  maxDrawdownPct: number;     // e.g. 0.10 = 10%
  dailyLossLimitPct: number;  // e.g. 0.02 = 2%
  maxPositionSizePct: number; // e.g. 0.05 = 5% of equity per position
  maxOpenPositions: number;
  maxOrderQty: number;
}

export interface RiskCheckResult {
  approved: boolean;
  reason?: RiskEvent;
  detail?: string;
}

// ─── Backtester ──────────────────────────────────────────────────────────────

export interface BacktestConfig {
  startTs: number;
  endTs: number;
  initialCapital: number;
  commissionPct: number;    // e.g. 0.0003
  slippagePct: number;      // e.g. 0.0002
  seed?: number;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  equity: { ts: number; value: number }[];
  metrics: PerformanceMetrics;
}

export interface BacktestTrade {
  symbol: string;
  side: Side;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  pnl: number;
  commission: number;
}

export interface PerformanceMetrics {
  totalReturn: number;
  cagr: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  maxDrawdownDuration: number; // bars
  winRate: number;
  profitFactor: number;
  totalTrades: number;
}

// ─── Alerts ──────────────────────────────────────────────────────────────────

export type AlertLevel = 'INFO' | 'WARN' | 'CRITICAL';

export interface AlertPayload {
  level: AlertLevel;
  title: string;
  body: string;
  ts: number;
  meta?: Record<string, unknown>;
}
