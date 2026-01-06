# Dashboard Redesign

**Date:** 2026-01-06
**Status:** Approved

## Overview

Redesign the dashboard with a modern fintech aesthetic, prioritizing active positions visibility while adding a hero portfolio performance graph.

## Design Decisions

- **Primary focus:** Active positions - what's happening now
- **Hero section:** Portfolio performance graph at top
- **Visual style:** Modern fintech (clean, spacious, subtle gradients, rounded corners)
- **Information:** Keep all existing sections, reorganize for better flow

---

## Section 1: Hero Performance Graph

Full-width portfolio performance chart at the top of the dashboard.

**Layout:**
- Left: Total portfolio value in large text ($1,000,000)
- Below value: Daily change (+$1,234 / +0.12%) in green/red
- Time period pills: `1D` `7D` `1M` `3M` `6M` `MTD` `YTD` `ALL`
- Chart: Area/line chart with gradient fill, ~250px height

**Features:**
- Hover crosshair with exact value and date
- Green fill when up, red when down
- Smooth animations on period change

---

## Section 2: Positions Table

Compact table showing all open positions.

**Columns:**
| Symbol | Shares | Entry | Current | P&L | P&L % | Stop | Stop % |
|--------|--------|-------|---------|-----|-------|------|--------|

**Features:**
- Sortable columns (default: P&L % descending)
- Compact rows (~40px height)
- Symbol clickable to position detail
- Green/red colors for P&L
- "View All" link to positions page

**Styling:**
- Subtle alternating row backgrounds
- Rounded container corners
- No heavy borders

---

## Section 3: Status Overview & P&L

**Row 1: Quick Stats (4 cards)**
- Trading Status (Ready/Blocked)
- Open Positions (7/40)
- Consecutive Losses (0)
- Capital Deployed ($64,496)

Refinements:
- Smaller, more compact cards
- Subtle gradient backgrounds
- Muted icons, prominent values

**Row 2: P&L Cards (3 cards)**
- Daily, Weekly, Monthly P&L
- Remove progress bars
- Larger P&L numbers
- Small limit text
- Tiny 7-day sparkline in each card

---

## Section 4: Capital & System Health

Two-column layout.

**Left: Capital & Risk (merged)**
- Capital utilization progress bar with threshold marker
- Risk limits in 2x2 grid:
  ```
  Daily Limit    -0.5%  |  Weekly Limit   -1.5%
  Monthly Limit  -3.0%  |  Max Capital    25%
  ```

**Right: System Health**
- Existing SystemHealth component (keep as-is)

---

## Section 5: Recent Activity

Streamlined activity feed.

- Show last 5 items (reduced from 10)
- Cleaner row layout: Icon | Symbol badge | Message | Time
- No borders, use spacing
- Muted colors

---

## Data Requirements

### New Table: `portfolio_snapshots`

```sql
CREATE TABLE portfolio_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  total_value DECIMAL(15,2) NOT NULL,
  cash DECIMAL(15,2),
  positions_value DECIMAL(15,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_portfolio_snapshots_date ON portfolio_snapshots(date);
```

### Daily Cron Job

- Run at market close (4:00 PM ET) on trading days
- Calculate: total_value = cash + sum(position values)
- Insert into portfolio_snapshots

### Data Population

- Start fresh from implementation date
- Graph populates naturally over time

---

## API Endpoints

### GET /portfolio/performance

Query params: `period` (1d, 7d, 1m, 3m, 6m, mtd, ytd, all)

Response:
```json
{
  "currentValue": 1000000,
  "periodStart": 985000,
  "periodChange": 15000,
  "periodChangePercent": 1.52,
  "dataPoints": [
    { "date": "2026-01-01", "value": 985000 },
    { "date": "2026-01-02", "value": 990000 },
    ...
  ]
}
```

---

## Component Structure

```
app/dashboard/page.tsx
components/
  PortfolioChart.tsx      (new)
  PositionsTable.tsx      (new)
  StatCards.tsx           (new)
  PnLCards.tsx            (new)
  CapitalRisk.tsx         (new)
  SystemHealth.tsx        (existing)
  RecentActivity.tsx      (new)
```

---

## Success Criteria

1. Dashboard loads in < 2 seconds
2. Chart updates smoothly on period change
3. Positions table is scannable at a glance
4. Mobile responsive (stacked layout)
5. Consistent modern fintech aesthetic
