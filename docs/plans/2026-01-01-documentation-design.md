# TradeGuard Documentation Design

**Goal:** Create comprehensive documentation in two forms - an AI reference file for Claude to prevent hallucinations/bugs, and a human-readable Docs page in the dashboard.

**Architecture:** Static documentation stored in codebase, rendered in dashboard UI.

---

## Part 1: AI Reference Documentation

**Location:** `docs/AI-REFERENCE.md`

**Purpose:** Dense technical reference that Claude reads at conversation start to understand the system accurately.

**Structure:**
- System Overview (tech stack, core flow)
- Data Sources (Polygon API only, no fake data)
- Key Invariants (rules that must never break)
- Module Reference (each module's responsibility)
- Common Pitfalls (mistakes to avoid)

**Constraints:**
- Single file, under 1000 lines
- Terse, technical language
- Facts extracted from actual code, not assumptions

---

## Part 2: Human Documentation Page

**Location:** `/dashboard/docs` route

**Layout:**
- Left sidebar with collapsible topic navigation
- Main content area (~800px max-width)
- Dark theme matching dashboard

**Content Sections:**
1. Getting Started (Overview, Quick Start, Key Concepts)
2. User Guide (Watchlist, Opportunities, Positions, P&L, Simulation, Settings)
3. Trading Logic (Qualification Rules, Scoring, Position Sizing, Trailing Stops, Risk)
4. Technical Reference (API Endpoints, Database Schema, IB Gateway, Environment)

**Implementation:**
- `page.tsx` - Main layout with sidebar + content
- `content.ts` - All docs as typed TypeScript data
- Simple regex-based markdown rendering (no external library)
- No search, versioning, or edit features

---

## Trading Logic to Document

**Buy Qualification:**
- ADV45 minimum volume
- SMA200 trend detection (Uptrend/Flat/Declining based on 20-day slope)
- Extension limit: < 20% above SMA200
- Pullback range: 5-8% from 63-day high
- Bounce confirmation: Close >= Pullback Low * 1.02
- Sharp drop filter: Max 2 days with >3% drop
- Stop distance filter: Max 6%

**Position Sizing:**
- Risk per trade % (configurable)
- Share count = Risk $ / (Entry - Stop)
- Max capital deployed limit
- Minimum order: $100

**Structure-Based Trailing Stop:**
- Initial stop: Pullback low * (1 - 0.7% buffer)
- Stop ratchets UP only when new structural low > current stop
- Never moves down

**Scoring Weights:**
- Volume Surge: 30%
- Technical Breakout: 30%
- Sector Momentum: 20%
- Volatility Fit: 20%

---

## Deliverables

1. `docs/AI-REFERENCE.md` - AI reference document
2. Dashboard sidebar updated with "Docs" nav item
3. `/dashboard/docs/page.tsx` - Docs page component
4. `/dashboard/docs/content.ts` - Documentation content data
