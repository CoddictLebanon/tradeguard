# TradeGuard - Trading Bot Design

## Overview

**TradeGuard** is an AI-powered trading assistant for Interactive Brokers that monitors stocks, analyzes news and technicals, and recommends trades for manual approval.

### Core Philosophy
- Bot researches and recommends; you approve and control
- Conservative risk management with configurable guardrails
- Paper trading mandatory before live deployment

### Portfolio Context
- Portfolio size: $1,000,000
- Target return: 10% annually ($100,000/year, ~$400/trading day)
- Position size: 1% per trade ($10,000)
- Trailing stop: Configurable per trade with ATR-based defaults

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js (React + TypeScript) |
| Backend | NestJS (Node.js + TypeScript) |
| Database | PostgreSQL |
| IB Integration | @stoqey/ib |
| Data Provider | Polygon.io ($29/mo) + Finnhub (free) |
| AI | Claude API / OpenAI (~$30-50/mo) |
| Hosting | Cloud VPS (DigitalOcean/AWS, $10-20/mo) |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Next.js Frontend                         │
│  (Dashboard, trade approval, settings, analytics)          │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                    NestJS Backend                           │
│  - REST API + WebSocket gateway                            │
│  - Modular services (trades, data, strategy, notifications)│
│  - Scheduled jobs (market scanning, stop monitoring)       │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                   AI Agent Layer                            │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │
│  │News Analysis│ │Trade Reason.│ │ Risk Assessment     │   │
│  │   Agent     │ │   Agent     │ │     Agent           │   │
│  └─────────────┘ └─────────────┘ └─────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
┌──────────────────────────────┬──────────────────────────────┐
│       Data Sources           │       Trading                │
│  ┌────────────────────────┐  │  ┌────────────────────────┐  │
│  │ Polygon.io ($29/mo)    │  │  │ Interactive Brokers    │  │
│  │ - Real-time prices     │  │  │ - Order execution      │  │
│  │ - News & sentiment     │  │  │ - Position data        │  │
│  │ - Historical data      │  │  │ - Account info         │  │
│  └────────────────────────┘  │  └────────────────────────┘  │
│  ┌────────────────────────┐  │                              │
│  │ Finnhub (free)         │  │                              │
│  │ - Supplemental news    │  │                              │
│  │ - Sentiment scores     │  │                              │
│  └────────────────────────┘  │                              │
└──────────────────────────────┴──────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                      PostgreSQL                             │
│  (Positions, history, settings, watchlist, scores)         │
└─────────────────────────────────────────────────────────────┘
```

---

## Stock Selection

### Stock Universe
- **Core Watchlist:** 20-30 stocks you curate manually
- **Screener Candidates:** 5-10 added daily based on scoring

### Multi-Factor Scoring System (0-100)

| Factor | Weight | Description |
|--------|--------|-------------|
| Volume Surge | 25% | Today's volume vs 20-day average |
| Technical Breakout | 25% | Price vs resistance, MA crossovers |
| Sector Momentum | 20% | Sector performance today/this week |
| News Sentiment | 15% | Positive headlines in last 24h |
| Volatility Fit | 15% | ATR in optimal range |

### Thresholds
- Score 70+ → High priority, surfaces to top
- Score 50-69 → Worth reviewing
- Score <50 → Filtered out

---

## AI Agent Layer

### 1. News Analysis Agent
- **Trigger:** New article about watched stock
- **Function:** Reads full text, extracts sentiment, key facts, implications
- **Outputs:** Structured analysis + risk flags

### 2. Trade Reasoning Agent
- **Trigger:** Stock scores above threshold
- **Inputs:** Technical data + news analysis + context
- **Outputs:**
  - Plain English recommendation
  - Bull case / Bear case
  - Confidence score (0-100)
  - Suggested entry, stop, target
  - Warnings and concerns

### 3. Risk Assessment Agent
- **Trigger:** Before any trade approval
- **Checks:**
  - Portfolio correlation
  - Macro risks (Fed meetings, earnings)
  - Position sizing sanity
  - Daily exposure limits
- **Outputs:** Go / Caution / Stop recommendation

---

## Trade Flow

1. **Discovery** (every 5 min during market hours)
   - Scan watchlist + screener candidates
   - Calculate scores, filter threshold
   - Queue high-scoring opportunities

2. **Dashboard Review** (you)
   - See ranked opportunities with AI analysis
   - Approve, reject, or modify parameters

3. **Execution** (bot)
   - Send order to IB via API
   - Confirm fill, set trailing stop
   - Notify you of execution

4. **Position Monitoring** (continuous)
   - Track price, adjust trailing stop
   - Monitor for adverse news
   - Alert if intervention suggested

5. **Exit**
   - Trailing stop triggered → auto-close
   - OR manual close via dashboard
   - Record P&L, update statistics

---

## Dashboard Interface

### Main Views
1. **Opportunities Panel** - Ranked trade candidates with AI analysis
2. **Active Positions** - Open positions with real-time P&L
3. **Portfolio Overview** - Total value, charts, win rate, exposure
4. **Activity Feed** - Chronological log of all actions
5. **Settings** - All configurable parameters

### Real-time Updates
- WebSocket for live prices
- Push updates on stop triggers
- No manual refresh needed

### Notifications (configurable)
- Stop-loss triggered
- Position closed
- Daily limit hit
- Large price movements

---

## Safety & Guardrails

### Circuit Breakers (all configurable)

| Limit | Default | Action |
|-------|---------|--------|
| Daily Loss | 1.5% ($15,000) | No new trades, alert |
| Weekly Loss | 3% ($30,000) | Pause until Monday |
| Consecutive Losses | 5 trades | Pause, force review |
| Max Open Positions | 20 | No new entries |
| Max Sector Exposure | 30% | Warn, require override |

### Order Validation
- Position size ≤ configured max
- Stop loss is set
- Not duplicate position
- Market is open
- Sufficient buying power
- Not in circuit breaker state

### Paper Trading Gate
- New install → Paper mode only
- Minimum: 2 weeks OR 50 trades
- Must show profit to unlock live mode
- Manual acknowledgment to go live

### Audit Trail
- Every action logged
- Full order history with context
- Daily P&L snapshots
- Exportable for taxes

---

## Database Schema

### Core Tables
- **users** - User account and settings
- **watchlist** - Curated stock list
- **opportunities** - Scored candidates with AI analysis
- **positions** - Open trades
- **trades** - Completed trades (history)
- **orders** - IB order tracking
- **news_cache** - Analyzed articles
- **activity_log** - Full audit trail
- **settings** - Configurable parameters
- **daily_snapshots** - EOD portfolio state

---

## Trading Parameters

- **Hours:** Regular market only (9:30 AM - 4:00 PM ET)
- **Position Sizing:** 1% of portfolio per trade ($10k)
- **Trailing Stop:** Configurable per trade, ATR-based defaults
- **Concurrent Positions:** Dynamic based on market conditions (5-30)
- **Entry:** Manual approval via dashboard
- **Exit:** Automatic via trailing stop or manual

---

## Monthly Costs

| Service | Cost |
|---------|------|
| Polygon.io | $29 |
| AI APIs (Claude/OpenAI) | $30-50 |
| Cloud VPS | $10-20 |
| **Total** | **~$70-100/month** |

Annual cost: ~$1,000 (1% of target return)

---

## Key Decisions Summary

1. **Broker:** Interactive Brokers
2. **Stack:** Next.js + NestJS + PostgreSQL + TypeScript
3. **Data:** Polygon.io + Finnhub
4. **AI:** Full integration (news, reasoning, risk agents)
5. **Entry:** Manual approval via web dashboard
6. **Exit:** Trailing stop-loss (configurable per trade)
7. **Safety:** Multi-layer circuit breakers, mandatory paper trading
8. **Notifications:** Configurable push alerts for critical events
