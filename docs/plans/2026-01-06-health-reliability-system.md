# Health & Reliability System Design

**Date:** 2026-01-06
**Status:** Approved

## Overview

A Unified Health Service that addresses four reliability concerns:
1. Data Sync Issues - IB ↔ Database reconciliation
2. Silent Failures - Better error notification/alerting
3. System Health Blindspots - Health monitoring dashboard
4. Recovery After Outages - Automatic reconciliation on startup/reconnect

Notifications via Dashboard + Telegram for critical alerts.

---

## Architecture

### Components

**HealthModule** (NestJS) containing:

- **HealthService** - Runs health checks every 30 seconds, tracks system status, triggers alerts
- **ReconciliationService** - Keeps IB and database positions in sync
- **HealthController** - API endpoints for health status and manual reconciliation

### Integration

- Uses existing TelegramModule for alerts
- Uses existing IBService for IB communication
- Uses existing PositionsService for database operations

---

## Health Checks

Run every 30 seconds, monitoring:

| Component | Check | Healthy | Degraded | Critical |
|-----------|-------|---------|----------|----------|
| IB Proxy | `GET /health` on port 5001 | Responds <5s | - | No response |
| IB Gateway | `GET /positions` returns data | Connected | Slow >10s | Disconnected |
| Database | `SELECT 1` query | <2s | - | Timeout |
| Position Sync | IB count vs DB count | Match | Mismatch | - |
| Cron Jobs | Recent run in `cron_logs` | <35 min ago | Missed 1 | Missed 3+ |

**Overall Status:**
- `healthy` - All components healthy
- `degraded` - One or more degraded
- `critical` - Any component critical

---

## Reconciliation Service

### When It Runs

- On app startup (always)
- Every 5 minutes during market hours (9:30 AM - 4:00 PM ET, weekdays)
- Manually via `POST /health/reconcile`
- When health check detects position count mismatch

### Logic

```
1. Fetch all positions from IB
2. Fetch all OPEN positions from database
3. Compare:

   For each IB position NOT in database:
   → Create database entry with default 5% stop
   → Log to activity_log: "Synced missing position: {symbol}"
   → Alert via Telegram

   For each database position NOT in IB:
   → Mark as CLOSED in database
   → Log to activity_log: "Closed stale position: {symbol}"
   → Alert via Telegram

   For each matching position:
   → Update shares/avgCost from IB if different
```

### Safety Guards

- Never delete data, only mark as closed
- Log every action to `activity_log` table
- Rate limit: max 1 reconciliation per minute
- Dry-run mode: `POST /health/reconcile?dryRun=true`

---

## Dashboard UI

New "System Health" section on main dashboard:

```
┌─────────────────────────────────────────────────┐
│ System Health                              [●]  │
├─────────────────────────────────────────────────┤
│ IB Gateway      ● Connected         < 1s       │
│ IB Proxy        ● Healthy           < 100ms    │
│ Database        ● Healthy           < 50ms     │
│ Position Sync   ● In Sync           7/7        │
│ Trailing Stops  ● Running           12 min ago │
├─────────────────────────────────────────────────┤
│ Last check: 15 seconds ago    [Reconcile Now]  │
└─────────────────────────────────────────────────┘
```

- Auto-refreshes every 30 seconds
- Click component for details
- Manual reconcile button

---

## Telegram Alerts

Sent when status **changes** (not on every check):

- `🔴 CRITICAL: IB Gateway disconnected`
- `🟡 DEGRADED: Position sync mismatch (IB: 7, DB: 5)`
- `🟢 RECOVERED: IB Gateway reconnected`
- `🔄 RECONCILED: Synced 2 missing positions (IBM, NEE)`

Rate limited: Same alert won't repeat for 5 minutes.

---

## Data Model

### New Table: `health_logs`

```sql
CREATE TABLE health_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  component VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  response_time INTEGER,
  details JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_health_logs_timestamp ON health_logs(timestamp);
CREATE INDEX idx_health_logs_component ON health_logs(component);
```

Retention: Auto-delete logs older than 7 days.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Quick status for uptime monitors |
| GET | `/health/detailed` | Full component breakdown |
| GET | `/health/history` | Last 24 hours of health logs |
| POST | `/health/reconcile` | Trigger manual reconciliation |
| POST | `/health/reconcile?dryRun=true` | Preview reconciliation |

### Response: `/health/detailed`

```json
{
  "status": "healthy",
  "timestamp": "2026-01-06T01:00:00Z",
  "components": {
    "ibGateway": { "status": "healthy", "responseTime": 120, "message": "Connected" },
    "ibProxy": { "status": "healthy", "responseTime": 45 },
    "database": { "status": "healthy", "responseTime": 12 },
    "positionSync": { "status": "healthy", "ibCount": 7, "dbCount": 7 },
    "cronJobs": { "status": "healthy", "lastRun": "2026-01-06T00:45:00Z" }
  },
  "lastReconciliation": "2026-01-06T00:50:00Z"
}
```

---

## Error Handling

### Graceful Degradation

- IB Proxy down → health checks continue for other components
- Telegram fails → alerts logged, don't block health checks
- Database slow → timeout after 5 seconds

### Startup Behavior

1. App starts → wait 10 seconds for services
2. Run initial health check
3. Run reconciliation
4. Begin 30-second health check cycle

### Edge Cases

- IB Gateway reconnects → auto-reconciliation triggers
- Server restarts → full reconciliation on startup
- Reconciliation already running → skip duplicate request

---

## Implementation Files

### Backend (apps/api/src/)

```
health/
├── health.module.ts
├── health.service.ts
├── health.controller.ts
├── reconciliation.service.ts
└── entities/
    └── health-log.entity.ts
```

### Frontend (apps/web/src/)

```
components/
└── SystemHealth.tsx

app/dashboard/
└── page.tsx (add SystemHealth component)
```

---

## Success Criteria

1. Health dashboard shows real-time status of all components
2. Telegram alerts fire within 60 seconds of status change
3. Reconciliation auto-syncs missing positions on startup
4. No more orphaned positions (IB exists, DB missing)
5. Clear visibility into system health at a glance
