export interface DocSection {
  id: string;
  title: string;
  content: string;
}

export interface DocCategory {
  id: string;
  title: string;
  icon: string;
  sections: DocSection[];
}

export const documentationContent: DocCategory[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: '🚀',
    sections: [
      {
        id: 'overview',
        title: 'Overview',
        content: `
# Overview

TradeGuard is a semi-automated swing trading system that:

1. **Scans** your watchlist for stocks meeting strict buy criteria
2. **Qualifies** opportunities using technical analysis rules
3. **Sizes positions** based on risk management rules
4. **Manages stops** using structure-based trailing stop logic
5. **Tracks performance** with P&L reporting and simulation

## Core Philosophy

- **Conservative risk management**: Risk only 0.15% of capital per trade
- **Technical-only analysis**: All decisions based on price action, no news sentiment
- **Structure-based stops**: Stops follow market structure, not arbitrary percentages
- **Real data only**: All prices from Polygon API, never simulated

## System Components

| Component | Purpose |
|-----------|---------|
| Dashboard | Overview of trading status and P&L |
| Opportunities | Review and approve qualified trades |
| Positions | Monitor open positions and stops |
| Watchlist | Manage symbols to scan |
| Simulation | Backtest trades with historical data |
| Settings | Configure risk parameters |
        `,
      },
      {
        id: 'quick-start',
        title: 'Quick Start',
        content: `
# Quick Start

## 1. Add Symbols to Watchlist

Go to **Watchlist** and add stock symbols you want to monitor. The scanner will evaluate these for buy opportunities.

## 2. Run a Scan

Click **Scan Now** on the Opportunities page. The system will:
- Fetch 260 days of price data for each symbol
- Calculate technical indicators (SMA200, RSI, etc.)
- Check if each stock meets the buy qualification rules
- Create opportunities for qualifying stocks

## 3. Review Opportunities

Each opportunity shows:
- **Score**: Overall quality rating
- **Qualification metrics**: Pullback depth, trend state, etc.
- **Position sizing**: Shares and dollar amount based on your risk settings

## 4. Approve or Reject

- **Approve**: Opens a position via IB Gateway
- **Reject**: Dismisses the opportunity

## 5. Monitor Positions

Open positions show:
- Current price (live from Polygon)
- Unrealized P&L
- Current stop price
- Days held

The system automatically adjusts stops based on price structure.
        `,
      },
      {
        id: 'key-concepts',
        title: 'Key Concepts',
        content: `
# Key Concepts

## Pullback Trading

This system looks for stocks that:
1. Are in an **uptrend** (SMA200 rising)
2. Have pulled back **5-8%** from recent highs
3. Are showing signs of **bouncing** from support

The idea is to buy strong stocks on temporary weakness, not to catch falling knives.

## Structure-Based Stops

Unlike percentage trailing stops, this system uses **market structure**:

- **Structural High**: The highest close since entry
- **Structural Low**: The lowest low since the structural high
- **Stop Level**: Structural low minus a 0.7% buffer

The stop only moves UP when a new, higher structural low forms. This prevents getting stopped out on normal pullbacks while protecting gains.

## Risk Per Trade

Position size is calculated to risk a fixed dollar amount:

\`\`\`
Risk per trade = Total Capital × 0.15%
Shares = Risk / (Entry Price - Stop Price)
\`\`\`

Example: $1M capital, 0.15% risk = $1,500 risk per trade.
If entry is $100 and stop is $95, you buy 300 shares ($1,500 / $5).

## Simulation Mode

Test your strategy with historical data:
1. Enable simulation mode in Settings
2. Set the "as of" date (pretend today is that date)
3. Run scans and approve trades
4. See how they would have played out
        `,
      },
    ],
  },
  {
    id: 'user-guide',
    title: 'User Guide',
    icon: '📚',
    sections: [
      {
        id: 'watchlist',
        title: 'Watchlist Management',
        content: `
# Watchlist Management

The watchlist contains symbols that the scanner evaluates for buy opportunities.

## Adding Symbols

1. Go to the **Watchlist** page
2. Enter a stock symbol (e.g., AAPL)
3. Click **Add**

## Removing Symbols

Click the **Remove** button next to any symbol.

## Best Practices

- Add stocks you've researched fundamentally
- Focus on liquid, large-cap stocks
- Consider sector diversification
- Remove symbols that consistently fail qualification
        `,
      },
      {
        id: 'opportunities',
        title: 'Understanding Opportunities',
        content: `
# Understanding Opportunities

Opportunities are stocks from your watchlist that meet the buy qualification criteria.

## Opportunity Card

Each card shows:

| Field | Meaning |
|-------|---------|
| Symbol | Stock ticker |
| Score | Quality rating (higher is better) |
| Current Price | Live price from Polygon |
| Trend State | Uptrend, Flat, or Declining |
| Pullback | How far price has dropped from recent high |
| Stop Distance | How far the stop is from entry |

## Qualification Metrics

Click an opportunity to see detailed metrics:

- **ADV45**: Average daily volume (45 days)
- **SMA200**: 200-day moving average
- **Extension %**: How far above/below SMA200
- **Recent High**: Highest close in 63 days
- **Pullback Low**: Support level for stop placement
- **Bounce OK**: Whether price has bounced from support

## Position Sizing

The system calculates:
- **Shares**: How many to buy
- **Position $**: Total dollar amount
- **Risk $**: Maximum loss if stopped out
- **Stop %**: Distance from entry to stop

## Actions

- **Approve**: Execute the trade via IB Gateway
- **Reject**: Dismiss (won't appear again this scan)
        `,
      },
      {
        id: 'positions',
        title: 'Managing Positions',
        content: `
# Managing Positions

The Positions page shows all open trades.

## Position Table

| Column | Description |
|--------|-------------|
| Symbol | Stock ticker |
| Shares | Number of shares held |
| Capital | Total position value |
| Entry | Purchase price |
| Current | Live price (refreshes on page load) |
| Stop | Current stop loss price |
| Stop % | Distance from entry to stop |
| P/L | Unrealized profit/loss |

## Position Details

Click a position to see:
- Entry date and price
- Stop price history
- Activity timeline (stop raises, etc.)

## Closing Positions

Click **Close** to sell the position at market price.

**Note:** Closing a position also cancels any associated stop order on IB Gateway.

## Stop Updates

The system automatically reviews positions daily and raises stops when:
1. Price makes a new structural high
2. A higher low forms
3. Price bounces above the new low (confirms support)

You'll see stop updates in the position's activity timeline.
        `,
      },
      {
        id: 'pnl',
        title: 'P&L & Performance',
        content: `
# P&L & Performance

The P&L page shows your trading performance.

## Live Trading Stats

- **Daily P&L**: Today's gains/losses
- **Weekly P&L**: This week's performance
- **Monthly P&L**: This month's performance
- **Open Positions**: Count of current positions
- **Capital Deployed**: Percentage of capital in use

## Activity Log

Recent trading activity:
- Positions opened
- Positions closed
- Stop price updates
- Errors and warnings

## Simulation Stats (when enabled)

When simulation mode is active, you'll see:
- **Total Trades**: Number of simulated trades
- **Win Rate**: Percentage of winning trades
- **Avg P&L %**: Average return per trade
- **Avg Days Held**: Typical holding period
- **Best/Worst Trade**: Extremes

Simulated trades are stored separately from live trades.
        `,
      },
      {
        id: 'simulation',
        title: 'Simulation Mode',
        content: `
# Simulation Mode

Test your strategy with historical data before risking real money.

## Enabling Simulation

1. Go to **Settings**
2. Toggle **Enable Simulation Mode**
3. Set the **Simulation Date** (the "as of" date)
4. Click **Save**

## How It Works

When simulation mode is enabled:
- Scans use historical data as of the simulation date
- Approving trades runs a backtest instead of placing real orders
- Results show how the trade would have performed

## Simulation Results

After approving a simulated trade, you'll see:
- Entry and exit dates
- Exit reason (stopped out, max days, etc.)
- P&L in dollars and percent
- Daily price chart with stop levels
- Event timeline (stop raises)

## Clearing History

Click **Clear Simulation History** to remove all simulated trades.

## Tips

- Set simulation date at least 60 days in the past
- Review multiple trades to understand strategy performance
- Compare simulated win rate to expectations
        `,
      },
      {
        id: 'settings',
        title: 'Settings & Configuration',
        content: `
# Settings & Configuration

## Account Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Total Capital | $1,000,000 | Your trading capital |
| Risk Per Trade | 0.15% | Max risk per position ($1,500 default) |
| Max Capital Deployed | 25% | Max % of capital in positions |
| Stop Buffer | 0.7% | Buffer below pullback low for stops |

## Risk Limits

| Setting | Default | Description |
|---------|---------|-------------|
| Daily Loss Limit | 0.5% | Pause trading if hit |
| Weekly Loss Limit | 1.5% | Pause trading if hit |
| Monthly Loss Limit | 3% | Pause trading if hit |
| Max Open Positions | 12 | Maximum concurrent positions |
| Min Stop Distance | 2% | Reject if stop too tight |
| Max Stop Distance | 6% | Reject if stop too wide |

## Trading Controls

- **Pause Trading**: Stop all new positions
- **Resume Trading**: Re-enable trading
- **Paper/Live Mode**: Toggle between paper and live trading

## IB Gateway Status

Shows connection status to Interactive Brokers:
- **Connected**: Orders will execute on IB
- **Disconnected**: Click to reconnect

**Important:** If IB is disconnected, approving opportunities will fail.
        `,
      },
    ],
  },
  {
    id: 'trading-logic',
    title: 'Trading Logic',
    icon: '🧮',
    sections: [
      {
        id: 'qualification-rules',
        title: 'Buy Qualification Rules',
        content: `
# Buy Qualification Rules

A stock must pass ALL these checks to become an opportunity.

## 1. Data Requirement

Must have at least **221 trading days** of price history to calculate all indicators.

## 2. Trend State

The 200-day SMA must be **rising** (Uptrend).

\`\`\`
Slope = SMA200_today - SMA200_20_days_ago
Uptrend: Slope > 0
Flat: |Slope| <= 0.1% of SMA200
Declining: Slope < 0
\`\`\`

## 3. Extension Check

Stock must not be **over-extended** above SMA200.

\`\`\`
Extension = (Close - SMA200) / SMA200
Pass: Extension < 20%
\`\`\`

## 4. Pullback Depth

Must have pulled back **5-8%** from the 63-day high.

\`\`\`
Recent High = max(Close) over last 63 days
Pullback = (Recent High - Close) / Recent High
Pass: 5% <= Pullback <= 8%
\`\`\`

## 5. Bounce Confirmation

Price must have **bounced** from the pullback low.

\`\`\`
Pullback Low = min(Low) from Recent High date to today
Pass: Close >= Pullback Low × 1.02
\`\`\`

## 6. Above SMA200

Price must be **above** the 200-day moving average.

\`\`\`
Pass: Close > SMA200
\`\`\`

## 7. Sharp Drop Filter

No more than **2 days** with >3% drops in the last 63 days.

\`\`\`
Sharp Drop Day: (Close - Previous Close) / Previous Close < -3%
Pass: Count of sharp drop days < 3
\`\`\`

## 8. Stop Distance

Stop must be within **2-6%** of entry price.

\`\`\`
Stop = Pullback Low × (1 - 0.7%)
Stop Distance = (Entry - Stop) / Entry
Pass: 2% <= Stop Distance <= 6%
\`\`\`
        `,
      },
      {
        id: 'scoring',
        title: 'Scoring System',
        content: `
# Scoring System

Each opportunity receives a score (0-100) based on technical factors.

## Scoring Factors

| Factor | Weight | Description |
|--------|--------|-------------|
| Volume Surge | 30% | Current volume vs average |
| Technical Breakout | 30% | Price vs moving averages |
| Sector Momentum | 20% | Daily price change |
| Volatility Fit | 20% | ATR in sweet spot |

## Volume Surge (0-100)

\`\`\`
Volume Ratio = Today's Volume / Average Volume

Score:
- Ratio >= 3.0: 100
- Ratio >= 2.0: 60-100 (linear)
- Ratio >= 1.5: 30-60 (linear)
- Ratio < 1.5: 0-30 (linear)
\`\`\`

## Technical Breakout (0-100)

\`\`\`
+40 if Price > SMA20
+30 if Price > SMA50
+30 if RSI between 50-70
+10 if RSI >= 70 (overbought warning)
\`\`\`

## Sector Momentum (0-100)

Based on daily price change:
\`\`\`
Positive change: 50 + (change% × 20), max 100
Negative change: 50 + (change% × 10), min 0
\`\`\`

## Volatility Fit (0-100)

ATR (Average True Range) as % of price:
\`\`\`
2-5%: 100 (sweet spot)
<2%: ATR% × 50
5-8%: 100 - (ATR% - 5) × 20
>8%: max(0, 40 - (ATR% - 8) × 10)
\`\`\`

## Total Score

\`\`\`
Score = (VolumeSurge × 0.30) + (TechBreakout × 0.30) +
        (SectorMomentum × 0.20) + (VolatilityFit × 0.20)
\`\`\`
        `,
      },
      {
        id: 'position-sizing',
        title: 'Position Sizing',
        content: `
# Position Sizing

Position size is calculated to risk a fixed percentage of capital.

## The Formula

\`\`\`
Risk Per Trade ($) = Total Capital × Risk %
Risk Per Share ($) = Entry Price - Stop Price
Shares = floor(Risk Per Trade / Risk Per Share)
Position Size ($) = Shares × Entry Price
\`\`\`

## Example

\`\`\`
Total Capital: $1,000,000
Risk Per Trade: 0.15% = $1,500
Entry Price: $100
Stop Price: $95
Risk Per Share: $5

Shares = floor($1,500 / $5) = 300 shares
Position Size = 300 × $100 = $30,000
\`\`\`

## Validation Checks

The system rejects trades if:

1. **Stop too tight**: Stop distance < 2%
2. **Stop too wide**: Stop distance > 6%
3. **Capital limit**: Would exceed max capital deployed (25%)
4. **Zero shares**: Calculated shares = 0

## Configuration

Adjust in Settings:
- **Risk Per Trade %**: Default 0.15%
- **Max Capital Deployed %**: Default 25%
- **Stop Buffer**: Default 0.7% below pullback low
        `,
      },
      {
        id: 'trailing-stops',
        title: 'Structure-Based Trailing Stops',
        content: `
# Structure-Based Trailing Stops

Unlike simple percentage trailing stops, this system follows market structure.

## Core Concept

The stop is set just below **structural lows** - price levels where the market found support.

## How It Works

### Initial Stop
\`\`\`
Initial Stop = Pullback Low × (1 - 0.7%)
\`\`\`

### Tracking Structure

1. **Structural High**: Track the highest close since entry
2. **Structural Low**: Track the lowest low since the structural high
3. When price makes a **new high**, reset the structural low tracking

### Raising the Stop

The stop is raised when:

1. A **new higher low** forms (current structural low > previous structural low)
2. Price **bounces** from the low (close >= structural low × 1.02)
3. The **new stop** would be higher than current stop

\`\`\`
New Stop = Structural Low × (1 - 0.7%)
\`\`\`

### Key Rule: Stop Never Decreases

If the calculated new stop is lower than the current stop, it's ignored. Stops only ratchet up.

## Example

\`\`\`
Entry: $100, Initial Stop: $94 (pullback low was $94.66)

Day 5: Price hits $105, structural high = $105
Day 8: Price pulls back, low = $101
Day 10: Price bounces to $103 (> $101 × 1.02)
→ New structural low = $101
→ New stop = $101 × 0.993 = $100.29

Stop raised from $94 to $100.29
\`\`\`

## Why Structure-Based?

- Avoids getting stopped on normal pullbacks
- Lets winners run while protecting gains
- Based on actual market behavior, not arbitrary percentages
        `,
      },
      {
        id: 'risk-management',
        title: 'Risk Management',
        content: `
# Risk Management

Multiple layers protect your capital.

## Per-Trade Risk

- Maximum 0.15% of capital at risk per trade
- Stop loss defined before entry
- Position sized to match risk limit

## Portfolio Risk

| Limit | Default | Action |
|-------|---------|--------|
| Max Open Positions | 12 | Reject new trades |
| Max Capital Deployed | 25% | Reject new trades |

## Loss Limits

| Period | Limit | Action |
|--------|-------|--------|
| Daily | 0.5% | Pause trading |
| Weekly | 1.5% | Pause trading |
| Monthly | 3% | Pause trading |

When a limit is hit:
1. Trading automatically pauses
2. No new positions can be opened
3. Existing positions continue to be managed
4. Manual resume required

## Circuit Breaker

The system tracks:
- Consecutive losses
- P&L by day/week/month
- Capital deployed percentage

If any limit is breached, trading pauses automatically.

## Manual Controls

- **Pause Trading**: Stop all new positions immediately
- **Close Position**: Exit any position at market
- **Paper Mode**: Test without real orders

## IB Gateway Safety

- Orders only execute when IB is connected
- Connection status shown in header
- Auto-reconnect attempts every 5 seconds
- Database only updated after IB confirms order
        `,
      },
    ],
  },
  {
    id: 'technical',
    title: 'Technical Reference',
    icon: '⚙️',
    sections: [
      {
        id: 'api-endpoints',
        title: 'API Endpoints',
        content: `
# API Endpoints

Base URL: \`http://localhost:667\`

All endpoints except /auth/login require JWT authentication.

## Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /auth/login | Login, returns JWT token |

## Scanner

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /scanner/opportunities | List pending opportunities |
| POST | /scanner/scan | Trigger manual scan |
| POST | /scanner/opportunities/:id/approve | Approve opportunity |
| POST | /scanner/opportunities/:id/reject | Reject opportunity |
| POST | /scanner/opportunities/:id/calculate | Calculate position size |
| POST | /scanner/opportunities/dedup | Remove duplicates |

## Positions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /positions | List open positions |
| GET | /positions/all | List all positions (inc. closed) |
| GET | /positions/:id | Get single position |
| GET | /positions/:id/activity | Get position activity log |
| POST | /positions/:id/close | Close position |
| PUT | /positions/:id/trail | Update trail percent |

## Safety

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /safety/status | Get dashboard status |
| POST | /safety/pause | Pause trading |
| POST | /safety/resume | Resume trading |
| POST | /safety/limits | Update risk limits |
| GET | /safety/simulation | Get simulation config |
| POST | /safety/simulation | Update simulation config |
| POST | /safety/switch-to-live | Switch to live mode |
| POST | /safety/switch-to-paper | Switch to paper mode |

## Simulation

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /simulation/run | Run backtest |
| GET | /simulation/stats | Get simulation statistics |
| GET | /simulation/history | Get simulation history |
| DELETE | /simulation/history | Clear simulation history |

## Watchlist

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /watchlist | List watchlist |
| POST | /watchlist | Add symbol |
| DELETE | /watchlist/:id | Remove symbol |

## Activity

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /activity | Get activity log |
        `,
      },
      {
        id: 'database',
        title: 'Database Schema',
        content: `
# Database Schema

PostgreSQL database with TypeORM entities.

## Core Tables

### positions
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| symbol | varchar | Stock ticker |
| shares | int | Number of shares |
| entryPrice | decimal | Purchase price |
| currentPrice | decimal | Last known price |
| highestPrice | decimal | Highest price reached |
| stopPrice | decimal | Current stop level |
| trailPercent | decimal | Trail percentage |
| status | enum | OPEN, CLOSED |
| openedAt | timestamp | Entry date |
| closedAt | timestamp | Exit date |
| ibOrderId | varchar | IB order ID |
| ibStopOrderId | varchar | IB stop order ID |

### opportunities
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| symbol | varchar | Stock ticker |
| companyName | varchar | Company name |
| logoUrl | varchar | Logo URL |
| score | decimal | Quality score |
| factors | jsonb | Qualification metrics |
| currentPrice | decimal | Price at scan |
| suggestedEntry | decimal | Entry price |
| suggestedTrailPercent | decimal | Trail % |
| status | enum | PENDING, APPROVED, REJECTED |
| expiresAt | timestamp | Expiration |

### watchlist_items
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| symbol | varchar | Stock ticker |
| active | boolean | Include in scans |
| notes | text | User notes |

### activity_logs
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| type | enum | Activity type |
| symbol | varchar | Related symbol |
| positionId | uuid | Related position |
| message | text | Description |
| details | jsonb | Additional data |
| createdAt | timestamp | When it happened |

### settings
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| key | varchar | Setting key |
| value | jsonb | Setting value |

### simulated_trades
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| symbol | varchar | Stock ticker |
| entryPrice | decimal | Entry price |
| exitPrice | decimal | Exit price |
| shares | int | Shares |
| pnl | decimal | Profit/loss |
| pnlPercent | decimal | P&L % |
| daysHeld | int | Holding period |
| exitReason | varchar | Why exited |
| events | jsonb | Stop events |
| dailyData | jsonb | Daily OHLC |
        `,
      },
      {
        id: 'ib-gateway',
        title: 'IB Gateway Setup',
        content: `
# IB Gateway Setup

The system connects to Interactive Brokers via IB Gateway and a Python proxy.

## Architecture

\`\`\`
NestJS API → Python Proxy (6680) → IB Gateway (4002) → IB Servers
\`\`\`

## IB Gateway Configuration

1. Download IB Gateway from Interactive Brokers
2. Login with your IB credentials
3. Configure API settings:
   - Enable API connections
   - Port: 4002 (paper) or 4001 (live)
   - Allow connections from localhost

## Python Proxy

The proxy handles communication with IB Gateway.

**Location:** \`ib-proxy/proxy.py\`

**Start manually:**
\`\`\`bash
cd ib-proxy
python proxy.py
\`\`\`

**Or auto-started** by the API server via IBProxyManagerService.

## Proxy Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /health | Health check |
| GET | /status | Connection status |
| POST | /connect | Connect to IB |
| POST | /disconnect | Disconnect |
| GET | /account | Account summary |
| GET | /positions | IB positions |
| GET | /orders | Open orders |
| POST | /order/buy | Place buy order |
| POST | /order/sell | Place sell order |
| POST | /order/stop | Place stop order |
| PUT | /order/stop/:id | Modify stop |
| DELETE | /order/cancel/:id | Cancel order |

## Troubleshooting

**Proxy not starting:**
- Check Python dependencies: \`pip install fastapi uvicorn ib_insync\`
- Verify IB Gateway is running
- Check port 6680 is available

**Connection fails:**
- Verify IB Gateway API is enabled
- Check port 4002 is correct
- Ensure IB Gateway is logged in

**Orders not executing:**
- Check IB connection status in dashboard
- Verify paper/live mode matches IB Gateway
- Check IB Gateway for error messages
        `,
      },
      {
        id: 'environment',
        title: 'Environment Variables',
        content: `
# Environment Variables

Create a \`.env\` file in the project root.

## Required

\`\`\`bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/tradeguard

# Polygon API (market data)
POLYGON_API_KEY=your_polygon_api_key

# JWT Authentication
JWT_SECRET=your_jwt_secret_min_32_chars
\`\`\`

## Optional

\`\`\`bash
# Finnhub API (earnings calendar)
FINNHUB_API_KEY=your_finnhub_key

# API Port (default: 667)
PORT=667

# IB Gateway
IB_HOST=127.0.0.1
IB_PORT=4002
IB_CLIENT_ID=1

# IB Proxy Port (default: 6680)
IB_PROXY_PORT=6680

# Node environment
NODE_ENV=development
\`\`\`

## Getting API Keys

### Polygon
1. Go to https://polygon.io
2. Sign up for free account
3. Copy API key from dashboard

### Finnhub (optional)
1. Go to https://finnhub.io
2. Sign up for free account
3. Copy API key from dashboard

## Security Notes

- Never commit .env to git
- Use strong JWT secret (32+ chars)
- Keep API keys private
- Use paper trading mode for testing
        `,
      },
    ],
  },
];

// Helper to flatten sections for search/navigation
export function getAllSections(): Array<DocSection & { categoryId: string; categoryTitle: string }> {
  return documentationContent.flatMap(category =>
    category.sections.map(section => ({
      ...section,
      categoryId: category.id,
      categoryTitle: category.title,
    }))
  );
}
