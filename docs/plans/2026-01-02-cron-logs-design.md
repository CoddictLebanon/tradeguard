# Cron Job Logs - Design Document

**Goal:** Add a dedicated log viewer for the Trailing Stop Daily Reassessment cron job in the Settings page, showing execution history with full position-level details.

**Scope:** Only the Trailing Stop Reassessment job (runs daily at 5 PM ET)

---

## Data Model

New `cron_logs` table to store reassessment executions:

```typescript
@Entity('cron_logs')
export class CronLog {
  id: string;              // UUID
  jobName: string;         // 'trailing_stop_reassessment'
  status: 'success' | 'partial' | 'failed';
  startedAt: Date;
  completedAt: Date;

  // Summary stats
  positionsChecked: number;
  stopsRaised: number;
  failures: number;

  // Full breakdown - array of position updates
  details: {
    positionId: string;
    symbol: string;
    action: 'raised' | 'unchanged' | 'failed';
    oldStopPrice?: number;
    newStopPrice?: number;
    error?: string;
  }[];

  errorMessage?: string;   // Top-level error if entire job failed
}
```

**Retention:** Unlimited (no auto-deletion)

---

## Backend Changes

### TrailingStopService Updates

Modify `dailyReassessment()` to create and update CronLog records:

```typescript
async dailyReassessment(): Promise<void> {
  const cronLog = await this.cronLogRepo.save({
    jobName: 'trailing_stop_reassessment',
    status: 'running',
    startedAt: new Date(),
    positionsChecked: 0,
    stopsRaised: 0,
    failures: 0,
    details: [],
  });

  try {
    const openPositions = await this.getOpenPositions();

    for (const position of openPositions) {
      const result = await this.reassessPosition(position);
      cronLog.details.push({
        positionId: position.id,
        symbol: position.symbol,
        action: result.action,
        oldStopPrice: result.oldStopPrice,
        newStopPrice: result.newStopPrice,
        error: result.error,
      });

      cronLog.positionsChecked++;
      if (result.action === 'raised') cronLog.stopsRaised++;
      if (result.action === 'failed') cronLog.failures++;
    }

    cronLog.status = cronLog.failures > 0 ? 'partial' : 'success';
  } catch (error) {
    cronLog.status = 'failed';
    cronLog.errorMessage = error.message;
  } finally {
    cronLog.completedAt = new Date();
    await this.cronLogRepo.save(cronLog);
  }
}
```

### API Endpoint

```
GET /cron-logs?jobName=trailing_stop_reassessment&limit=50
```

Response:
```typescript
{
  logs: Array<{
    id: string;
    jobName: string;
    status: 'success' | 'partial' | 'failed';
    startedAt: string;
    completedAt: string;
    positionsChecked: number;
    stopsRaised: number;
    failures: number;
    details: Array<{
      positionId: string;
      symbol: string;
      action: 'raised' | 'unchanged' | 'failed';
      oldStopPrice?: number;
      newStopPrice?: number;
      error?: string;
    }>;
    errorMessage?: string;
  }>;
}
```

Protected by JWT authentication.

---

## UI Design

New collapsible section in the Notifications tab of Settings:

```
┌─────────────────────────────────────────────────────────┐
│  Notifications                                          │
├─────────────────────────────────────────────────────────┤
│  Telegram Bot Settings                                  │
│  ├─ Bot Token: ••••••••••                              │
│  ├─ Chat ID: ••••••••••                                │
│  └─ [Test Message]                                      │
│                                                         │
│  Notification Events                                    │
│  ├─ ☑ Position Opened                                  │
│  ├─ ☑ Stop Raised                                      │
│  └─ ☑ Position Closed                                  │
├─────────────────────────────────────────────────────────┤
│  ▼ Trailing Stop Reassessment Logs                     │
│  ┌───────────────────────────────────────────────────┐ │
│  │ Jan 2, 5:00 PM    ✓ Success                       │ │
│  │ 3 positions • 1 stop raised • 0 failures          │ │
│  │ ┌─ AAPL: $185.20 → $187.50 (raised)              │ │
│  │ ├─ MSFT: unchanged                                │ │
│  │ └─ NVDA: unchanged                                │ │
│  └───────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────┐ │
│  │ Jan 1, 5:00 PM    ✓ Success                       │ │
│  │ 2 positions • 0 stops raised • 0 failures         │ │
│  │ [Click to expand]                                 │ │
│  └───────────────────────────────────────────────────┘ │
│  ... (scrollable, unlimited history)                   │
└─────────────────────────────────────────────────────────┘
```

### UI Behavior

- Each log entry is expandable/collapsible
- Most recent entries shown first
- Status color-coded: green (success), yellow (partial), red (failed)
- Failed entries show error message prominently
- Details section shows per-position breakdown
- Lazy load more entries on scroll (pagination)

---

## Summary

| Aspect | Decision |
|--------|----------|
| **Scope** | Trailing Stop Reassessment only |
| **Retention** | Unlimited |
| **Detail level** | Full breakdown (per-position results) |
| **UI location** | Notifications tab, collapsible section |
| **Storage** | New `cron_logs` table with JSONB details |
