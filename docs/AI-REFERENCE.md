# TradeGuard AI Reference

> This document is for Claude to read at the start of conversations to understand the system accurately.
> Last updated: 2026-01-01

## System Overview

**Tech Stack:**
- API: NestJS (TypeScript) on port 667
- Web: Next.js (React) on port 3000
- Database: PostgreSQL with TypeORM
- IB Proxy: Python FastAPI on port 6680
- Data: Polygon.io API (all market data)

**Core Flow:**
```
Watchlist → Scanner → Opportunities → Approve → Position → Trailing Stop → Exit
```

## Data Sources (CRITICAL - NO FAKE DATA)

| Data | Source | Notes |
|------|--------|-------|
| Stock prices | Polygon API | `getQuote()`, `getBars()` |
| Technical indicators | Polygon API | Calculated from OHLCV bars |
| Position currentPrice | Polygon API | Refreshed on every fetch |
| Company info | Polygon API | `getTickerDetails()` |
| Earnings dates | Finnhub API | Calendar data only |
| Order execution | IB Gateway | Via Python proxy |

**INVARIANT:** All price data comes from Polygon API. Never hardcode prices. Never use Math.random() for prices.

## Key Invariants (Rules That Must Never Break)

1. **Database-IB Sync:** Database updates only AFTER successful IB operations
2. **Stop Only Ratchets Up:** Stop price can only increase, never decrease
3. **Real Prices Only:** currentPrice must come from Polygon, never fabricated
4. **Position Sizing:** Shares = floor(RiskUSD / (Entry - Stop))
5. **Max Stop Distance:** Reject if stop distance > 6%
6. **Bounce Confirmation:** Stop only raised after close >= pullbackLow * 1.02

## Buy Qualification Rules

Evaluated in `buy-qualification.service.ts`:

| Rule | Metric | Threshold |
|------|--------|-----------|
| Data requirement | Trading days | >= 221 |
| Trend | SMA200 slope | slope > 0 = Uptrend |
| Extension | (Close - SMA200) / SMA200 | < 20% |
| Pullback depth | (RecentHigh - Close) / RecentHigh | 5% - 8% |
| Bounce | Close vs PullbackLow | Close >= PullbackLow * 1.02 |
| Regime | Close vs SMA200 | Close > SMA200 |
| Sharp drops | Days with >3% drop in 63 days | < 3 days |
| Stop distance | (Entry - Stop) / Entry | <= 6% |

**Formulas:**
- `ADV45 = sum(volume[last 45 days]) / 45`
- `SMA200 = sum(close[last 200 days]) / 200`
- `RecentHigh = max(close[last 63 days])`
- `PullbackLow = min(low[from RecentHighDate to today])`
- `StopPrice = PullbackLow * (1 - 0.007)`

## Position Sizing

From `position-sizing.service.ts`:

```
RiskUSD = TotalCapital * RiskPerTradePercent
Shares = floor(RiskUSD / (Entry - Stop))
PositionUSD = Shares * Entry
```

**Default Config:**
- TotalCapital: $1,000,000
- RiskPerTradePercent: 0.15% ($1,500 per trade)
- MaxCapitalDeployed: 25%
- StopBuffer: 0.7% below pullback low
- MinStopDistance: 2%
- MaxStopDistance: 6%

## Structure-Based Trailing Stop

From `trailing-stop.service.ts`:

**Logic:**
1. Track structural high (highest close since entry)
2. Track structural low (lowest low since structural high)
3. When price makes new high, reset structural low tracking
4. When bounce confirmed (close >= structuralLow * 1.02):
   - Calculate potentialStop = structuralLow * (1 - 0.007)
   - If potentialStop > currentStop, raise stop
5. Stop NEVER moves down

**Key:** Stop only moves up when a HIGHER low forms and bounce is confirmed.

## Module Reference

| Module | Responsibility |
|--------|----------------|
| `scanner` | Scan watchlist, create opportunities |
| `positions` | CRUD for positions, live price refresh |
| `safety` | Circuit breaker, loss limits, pause trading |
| `strategy` | Buy qualification, scoring, trailing stops |
| `risk` | Position sizing calculations |
| `ib` | IB Gateway communication via proxy |
| `simulation` | Backtest trades with historical data |
| `data` | Polygon and Finnhub API clients |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /scanner/opportunities | List pending opportunities |
| POST | /scanner/scan | Trigger manual scan |
| POST | /scanner/opportunities/:id/approve | Approve opportunity |
| GET | /positions | List open positions (with live prices) |
| POST | /positions/:id/close | Close position |
| GET | /safety/status | Dashboard status + limits |
| POST | /safety/pause | Pause trading |
| POST | /simulation/run | Run backtest simulation |

## Common Pitfalls (Things I've Gotten Wrong)

1. **Fake price fluctuation:** Never add Math.random() to prices
2. **Hardcoded fallbacks:** Don't return placeholder prices (like `return 100`)
3. **DB before IB:** Don't save position before IB order succeeds
4. **Lowering stops:** Never allow stop to decrease
5. **Simulating when disconnected:** Don't fall back to simulation on IB errors
6. **Stale prices:** Always fetch fresh prices for positions

## File Locations

- Buy qualification: `apps/api/src/strategy/buy-qualification.service.ts`
- Position sizing: `apps/api/src/risk/position-sizing.service.ts`
- Trailing stop: `apps/api/src/strategy/trailing-stop.service.ts`
- Scanner: `apps/api/src/scanner/scanner.service.ts`
- Positions: `apps/api/src/positions/positions.service.ts`
- IB Service: `apps/api/src/ib/ib.service.ts`
- IB Proxy: `ib-proxy/proxy.py`
