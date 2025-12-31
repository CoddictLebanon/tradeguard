# Position Activity Timeline Design

## Overview

Add visibility into position lifecycle by showing a chronological activity timeline when clicking on a position. This enables users to see stop loss changes from the daily cron job and understand what happened to each position from open to close.

## Requirements

1. Log all position-related actions with `positionId` for easy querying
2. Show activity timeline in a slide-out drawer when clicking a position row
3. Display: position opened, stop raised (from → to with reason), position closed

## Data Model Changes

### ActivityLog Entity

Add `positionId` column:

```typescript
@Column({ nullable: true })
positionId: string;
```

### Activity Types Used

| Event | Type | Data Logged |
|-------|------|-------------|
| Position opened | `POSITION_OPENED` | Entry price, initial stop, shares |
| Stop raised | `TRAILING_STOP_UPDATED` | Previous stop, new stop, reason |
| Position closed | `POSITION_CLOSED` | Exit price, P&L |

## API Changes

### New Endpoint

```
GET /positions/:id/activity
```

Returns all activities for a position, ordered chronologically (ASC).

## Frontend Changes

### PositionActivityDrawer Component

Slide-out drawer with:

1. **Header** — Symbol, status badge (OPEN/CLOSED), entry date
2. **Summary** — Entry price, current stop, current P&L
3. **Timeline** — Chronological event list:
   ```
   ● Dec 15  OPENED       Entry $150.00, Stop $142.50
   ● Dec 20  STOP RAISED  $142.50 → $148.20 (New higher low)
   ● Dec 28  STOP RAISED  $148.20 → $155.10 (New higher low)
   ```

### Position Row Click Handler

Make table rows clickable to open the drawer with that position's data.

## Files to Modify

- `apps/api/src/entities/activity-log.entity.ts` — Add positionId column
- `apps/api/src/strategy/trailing-stop.service.ts` — Include positionId in logs
- `apps/api/src/ib/ib-events.service.ts` — Include positionId in open/close logs
- `apps/api/src/positions/positions.controller.ts` — Add activity endpoint
- `apps/web/src/app/dashboard/positions/page.tsx` — Add row click handler
- `apps/web/src/components/PositionActivityDrawer.tsx` — New component
- `apps/web/src/lib/api.ts` — Add API method
