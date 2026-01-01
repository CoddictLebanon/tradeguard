# Centralized Activity Log & Telegram Notifications

**Date:** 2026-01-01
**Status:** Approved

## Overview

Add a centralized activity log that combines all trade events into a single view, plus Telegram bot integration for real-time notifications.

## Scope

### Activity Log
- **Events tracked:** Position opened, stop raised, position closed (trade events only)
- **Dashboard widget:** Recent 10 events on main dashboard
- **Dedicated page:** `/dashboard/activity` with full filtering and pagination

### Telegram Notifications
- **Configurable:** Toggle each event type on/off
- **Message format:** Minimal (e.g., `📈 AAPL opened at $182.50`)
- **Setup:** Settings page with bot token, chat ID, and test button

---

## API Design

### New Endpoint: `GET /activity/feed`

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `startDate` | ISO date | Filter from date |
| `endDate` | ISO date | Filter to date |
| `type` | string | `position_opened`, `stop_raised`, `position_closed` |
| `symbol` | string | Filter by stock symbol |
| `outcome` | string | `win` or `loss` (closes only) |
| `limit` | number | Items per page (default 50) |
| `offset` | number | Pagination offset |

**Response:**
```json
{
  "items": [
    {
      "id": "uuid",
      "timestamp": "2026-01-01T14:32:00Z",
      "type": "position_closed",
      "symbol": "AAPL",
      "message": "Position closed at $187.25",
      "details": {
        "entryPrice": 182.50,
        "exitPrice": 187.25,
        "pnl": 245.00,
        "outcome": "win"
      },
      "positionId": "uuid"
    }
  ],
  "total": 142,
  "hasMore": true
}
```

---

## UI Design

### Dashboard Widget — Recent Activity

Location: Main dashboard page in the existing grid layout.

```
┌─ Recent Activity ──────────────────────────┐
│ 📈 AAPL   opened at $182.50         2h ago │
│ 🔼 MSFT   stop raised to $412.00    3h ago │
│ ✅ NVDA   closed +$380             yesterday│
│ 📈 GOOGL  opened at $178.25        yesterday│
│ ❌ TSLA   closed -$125             2 days   │
│                                             │
│                          View All →         │
└─────────────────────────────────────────────┘
```

**Row format:**
- Icon: 📈 opened, 🔼 stop raised, ✅ win, ❌ loss
- Symbol
- Action with price/P&L
- Relative timestamp

**Interactions:**
- Click row → opens Position Activity Drawer
- "View All" → navigates to `/dashboard/activity`

### Dedicated Activity Page

**URL:** `/dashboard/activity`

**Filter Bar:**
- Date Range: Today, Last 7 days, Last 30 days, Custom
- Type: All, Opened, Stop Raised, Closed
- Symbol: Text input with autocomplete
- Outcome: All, Wins, Losses (enabled when Type = Closed)

**Table Columns:**
| Time | Symbol | Event | Details | P&L |
|------|--------|-------|---------|-----|

- Rows clickable → Position Activity Drawer
- Pagination: 50 per page
- Green/red P&L text for closes

---

## Telegram Integration

### Backend Module: `apps/api/src/telegram/`

**TelegramService:**
- `sendMessage(text: string)` — sends to configured chat ID
- `sendTestMessage()` — sends verification message

**Settings (in Setting entity):**
| Key | Type | Description |
|-----|------|-------------|
| `telegram_bot_token` | string | Bot token (encrypted) |
| `telegram_chat_id` | string | User/group chat ID |
| `telegram_enabled` | boolean | Master toggle |
| `telegram_notify_opened` | boolean | Notify on position opened |
| `telegram_notify_stop_raised` | boolean | Notify on stop raised |
| `telegram_notify_closed` | boolean | Notify on position closed |

**Event Integration:**
- Hook into `ActivityLogService` when trade events are logged
- `TelegramNotifierService` listens and sends if enabled

**Message Templates:**
```
📈 AAPL opened at $182.50
🔼 MSFT stop raised to $412.00
✅ NVDA closed +$380.00
❌ TSLA closed -$125.00
```

**Error Handling:** Fire-and-forget. Log errors but don't block trade flow.

### Settings UI

Location: Settings page → new "Notifications" section

```
┌─ Notifications ────────────────────────────────────────────┐
│                                                            │
│  Telegram Integration                          [Enabled ○] │
│                                                            │
│  Bot Token                                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 7123456789:AAH...                                    │  │
│  └──────────────────────────────────────────────────────┘  │
│  ⓘ Create a bot via @BotFather on Telegram                 │
│                                                            │
│  Chat ID                                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 123456789                                            │  │
│  └──────────────────────────────────────────────────────┘  │
│  ⓘ Message @userinfobot to get your chat ID               │
│                                                            │
│  [Send Test Message]                                       │
│                                                            │
│  ─────────────────────────────────────────────────────     │
│  Notify me when:                                           │
│  ☑ Position opened                                         │
│  ☑ Stop raised                                             │
│  ☑ Position closed                                         │
│                                                            │
│                                        [Save]              │
└────────────────────────────────────────────────────────────┘
```

- Bot token uses `type="password"` with show/hide toggle
- "Send Test Message" disabled until credentials saved
- Success/error toast feedback

---

## Implementation Order

1. **Backend: Activity Feed API** — New endpoint with filtering
2. **Frontend: Dashboard Widget** — Recent Activity card
3. **Frontend: Activity Page** — Full page with filters and table
4. **Backend: Telegram Module** — Service, settings, event listener
5. **Frontend: Telegram Settings** — Notifications section in settings
6. **Testing & Polish** — End-to-end verification

---

## Dependencies

- `node-telegram-bot-api` or raw fetch to Telegram API
- Existing `ActivityLog` entity (no schema changes needed)
- Existing `Setting` entity for Telegram config
