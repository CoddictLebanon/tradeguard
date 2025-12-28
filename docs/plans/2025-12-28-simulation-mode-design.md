# Simulation Mode Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a simulation mode that lets users backtest trades by setting a historical date, scanning for opportunities as of that date, and instantly seeing trade outcomes when they click "Confirm Trade".

**Architecture:** Settings-driven mode toggle that switches data fetching to historical dates. Trade confirmation triggers a fast-forward simulation using daily bars, applying trailing stop logic until exit.

**Tech Stack:** Polygon.io historical data API, NestJS backend simulation service, React frontend with chart visualization (lightweight chart library).

---

## Overview

Simulation Mode is a feature that allows users to:
1. Set a simulation date in Settings (e.g., January 15, 2024)
2. Use the app as normal - Scan finds opportunities that qualified on that date
3. Click "Confirm Trade" to instantly see what would have happened
4. View results as summary + event log + price chart

## User Flow

1. **Enable Simulation Mode** in Settings
   - Toggle "Simulation Mode" ON
   - Set "Simulation Date" (date picker)
   - App shows visual indicator that simulation mode is active

2. **Scan for Opportunities**
   - Scanner uses historical data from simulation date
   - Opportunities list shows what qualified on that date
   - All metrics calculated from data available at that time

3. **Analyze and Select Trade**
   - Click opportunity to see details (same as live mode)
   - Click "Approve" to see position sizing modal
   - Click "Confirm Trade" to run simulation

4. **View Simulation Results**
   - Modal shows simulation running briefly
   - Results display: summary, event log, price chart
   - User can close and try another trade

## Simulation Logic

**Entry:**
- Entry price = close price on simulation date
- Position size calculated using current settings (capital, risk %)
- Stop price = pullback low × (1 - buffer)

**Daily Processing (fast-forward):**
```
for each trading day after entry:
  1. Get daily bar (open, high, low, close)
  2. Check if low <= stop price → EXIT (stopped out)
  3. If still holding:
     - If close > highest_close: update highest_close
     - Trail stop: new_stop = highest_close × (1 - trail_percent)
     - If new_stop > current_stop: update stop
  4. Check max holding period (default 60 days) → EXIT if exceeded
```

**Exit:**
- Record exit price (stop price if stopped out, close if max days)
- Calculate P&L: (exit - entry) × shares
- Calculate P&L %: (exit - entry) / entry × 100

## Results Display

**Summary Card:**
- Symbol, company name
- Entry: $XX.XX on YYYY-MM-DD
- Exit: $XX.XX on YYYY-MM-DD (reason: stopped out / max days)
- Days held: N
- P&L: +$X,XXX (+X.XX%)

**Event Log:**
```
Day 1  | ENTRY    | $150.00 | Stop: $141.00
Day 3  | STOP UP  | High: $156.00 | Stop: $141.00 → $146.64
Day 7  | STOP UP  | High: $162.00 | Stop: $146.64 → $152.28
Day 12 | EXIT     | Stopped at $152.28 | P&L: +$2.28 (+1.52%)
```

**Price Chart:**
- Candlestick or line chart of price from entry to exit
- Entry marker (green arrow/line)
- Trailing stop line (red, steps up over time)
- Exit marker (red X where stopped out)

## Backend Changes

**New Service: SimulationService**
- `runSimulation(symbol, entryDate, entryPrice, stopPrice, trailPercent, shares, maxDays)`
- Returns: { summary, events[], dailyData[] }

**Modified Scanner Service:**
- Accept optional `asOfDate` parameter
- When provided, fetch historical bars ending on that date
- Calculate all metrics using only data available at that time

**New Endpoint:**
- `POST /simulation/run` - Run trade simulation
- `GET /simulation/config` - Get/set simulation mode settings

## Frontend Changes

**Settings Page:**
- New "Simulation Mode" section
- Toggle: Enable/Disable
- Date picker: Simulation Date
- Visual indicator when active

**Dashboard Layout:**
- Show banner when simulation mode is active: "SIMULATION MODE - Date: Jan 15, 2024"

**Opportunities Page:**
- When simulation mode active, Confirm Trade triggers simulation instead of real trade
- New SimulationResultModal component

**SimulationResultModal:**
- Summary card at top
- Event log (scrollable)
- Price chart with markers
- "Close" button

## Data Requirements

**Polygon API calls for simulation:**
- Historical bars: `/v2/aggs/ticker/{symbol}/range/1/day/{from}/{to}`
- Need ~220 days before simulation date for SMA200 calculation
- Need ~60 days after simulation date for trade simulation

## Settings Storage

Add to existing settings:
```json
{
  "simulation_mode": {
    "enabled": false,
    "date": "2024-01-15"
  }
}
```

## UI Indicator

When simulation mode is active:
- Header shows "SIMULATION" badge (orange) instead of "PAPER" badge
- Simulation date displayed next to it
- All trade actions clearly indicate they are simulated

## Edge Cases

1. **Weekend/holiday selected** - Snap to nearest trading day
2. **Date too recent** - Need at least 60 trading days of future data, warn if less
3. **No opportunities found** - Show message, suggest different date
4. **Stock delisted** - Show error, skip that stock
5. **Data gaps** - Handle missing bars gracefully

## Success Criteria

1. User can enable simulation mode and set a date
2. Scan shows historically accurate opportunities for that date
3. Clicking Confirm Trade shows simulation results within 2 seconds
4. Results include summary, event log, and chart
5. Trailing stop logic matches live trading exactly
