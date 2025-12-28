# Simulation Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a simulation mode that lets users backtest trades by setting a historical date, scanning as of that date, and instantly seeing trade outcomes.

**Architecture:** Settings-driven mode toggle stores simulation config in the database. PolygonService gets new methods for historical date ranges. New SimulationService runs fast-forward trade simulations. Frontend shows simulation results in a modal with event log and chart.

**Tech Stack:** NestJS backend, PostgreSQL with TypeORM, React/Next.js frontend, Polygon.io API, lightweight-charts for visualization.

---

## Task 1: Add Simulation Settings to Backend

**Files:**
- Modify: `apps/api/src/safety/safety.types.ts`
- Modify: `apps/api/src/safety/circuit-breaker.service.ts`
- Modify: `apps/api/src/safety/safety.controller.ts`

**Step 1: Add simulation config types**

In `apps/api/src/safety/safety.types.ts`, add after the existing types:

```typescript
export interface SimulationConfig {
  enabled: boolean;
  date: string | null; // ISO date string YYYY-MM-DD
}

export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  enabled: false,
  date: null,
};
```

**Step 2: Add simulation config to CircuitBreakerService**

In `apps/api/src/safety/circuit-breaker.service.ts`, add a new private property after line 34:

```typescript
private simulationConfig: SimulationConfig = DEFAULT_SIMULATION_CONFIG;
```

Add import at top:
```typescript
import { SimulationConfig, DEFAULT_SIMULATION_CONFIG } from './safety.types';
```

**Step 3: Add load/save methods for simulation config**

In `loadSettings()` method, add after loading trading_state (around line 64):

```typescript
const simSetting = await this.settingRepo.findOne({
  where: { key: 'simulation_config' },
});
if (simSetting) {
  this.simulationConfig = { ...DEFAULT_SIMULATION_CONFIG, ...simSetting.value };
}
```

Add new methods:

```typescript
async getSimulationConfig(): Promise<SimulationConfig> {
  return { ...this.simulationConfig };
}

async updateSimulationConfig(config: Partial<SimulationConfig>): Promise<void> {
  this.simulationConfig = { ...this.simulationConfig, ...config };
  await this.settingRepo.save({
    key: 'simulation_config',
    value: this.simulationConfig,
    updatedAt: new Date(),
  });

  await this.activityRepo.save({
    type: ActivityType.SETTING_CHANGED,
    message: config.enabled ? 'Simulation mode enabled' : 'Simulation mode disabled',
    details: this.simulationConfig,
  });

  this.logger.log(`Simulation config updated: ${JSON.stringify(this.simulationConfig)}`);
}

isSimulationMode(): boolean {
  return this.simulationConfig.enabled && this.simulationConfig.date !== null;
}

getSimulationDate(): Date | null {
  if (!this.simulationConfig.enabled || !this.simulationConfig.date) {
    return null;
  }
  return new Date(this.simulationConfig.date);
}
```

**Step 4: Add controller endpoints**

In `apps/api/src/safety/safety.controller.ts`, add:

```typescript
@Get('simulation')
async getSimulationConfig() {
  return this.circuitBreaker.getSimulationConfig();
}

@Post('simulation')
async updateSimulationConfig(@Body() body: { enabled?: boolean; date?: string }) {
  await this.circuitBreaker.updateSimulationConfig(body);
  return { success: true, config: await this.circuitBreaker.getSimulationConfig() };
}
```

**Step 5: Commit**

```bash
git add apps/api/src/safety/
git commit -m "feat: add simulation config to backend settings"
```

---

## Task 2: Add Historical Data Methods to PolygonService

**Files:**
- Modify: `apps/api/src/data/polygon.service.ts`

**Step 1: Add getBarsForDateRange method**

Add this method to PolygonService:

```typescript
async getBarsForDateRange(
  symbol: string,
  fromDate: string,
  toDate: string,
  timespan: 'minute' | 'hour' | 'day' = 'day',
): Promise<StockBar[]> {
  const data = await this.fetch<any>(
    `/v2/aggs/ticker/${symbol}/range/1/${timespan}/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=5000`,
  );

  if (!data.results) {
    return [];
  }

  return data.results.map((bar: any) => ({
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
    timestamp: new Date(bar.t),
  }));
}
```

**Step 2: Add getBarsAsOf method for historical lookback**

```typescript
async getBarsAsOf(
  symbol: string,
  asOfDate: string,
  lookbackDays: number = 220,
  timespan: 'day' = 'day',
): Promise<StockBar[]> {
  const toDate = asOfDate;
  const to = new Date(asOfDate);
  const calendarDays = Math.ceil(lookbackDays * 1.5); // Account for weekends
  const from = new Date(to.getTime() - calendarDays * 24 * 60 * 60 * 1000);
  const fromDate = from.toISOString().split('T')[0];

  return this.getBarsForDateRange(symbol, fromDate, toDate, timespan);
}
```

**Step 3: Commit**

```bash
git add apps/api/src/data/polygon.service.ts
git commit -m "feat: add historical date range methods to PolygonService"
```

---

## Task 3: Create SimulationService

**Files:**
- Create: `apps/api/src/simulation/simulation.service.ts`
- Create: `apps/api/src/simulation/simulation.module.ts`
- Create: `apps/api/src/simulation/simulation.controller.ts`
- Create: `apps/api/src/simulation/simulation.types.ts`
- Modify: `apps/api/src/app.module.ts`

**Step 1: Create simulation types**

Create `apps/api/src/simulation/simulation.types.ts`:

```typescript
export interface SimulationInput {
  symbol: string;
  entryDate: string; // YYYY-MM-DD
  entryPrice: number;
  shares: number;
  stopPrice: number;
  trailPercent: number; // e.g., 0.06 for 6%
  maxDays?: number; // default 60
}

export interface SimulationEvent {
  day: number;
  date: string;
  type: 'ENTRY' | 'STOP_RAISED' | 'EXIT';
  price: number;
  stopPrice: number;
  note?: string;
}

export interface SimulationResult {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  exitReason: 'stopped_out' | 'max_days' | 'data_ended';
  shares: number;
  daysHeld: number;
  pnl: number;
  pnlPercent: number;
  highestPrice: number;
  events: SimulationEvent[];
  dailyData: Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    stopPrice: number;
  }>;
}
```

**Step 2: Create SimulationService**

Create `apps/api/src/simulation/simulation.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PolygonService } from '../data/polygon.service';
import { SimulationInput, SimulationResult, SimulationEvent } from './simulation.types';

@Injectable()
export class SimulationService {
  private readonly logger = new Logger(SimulationService.name);

  constructor(private readonly polygonService: PolygonService) {}

  async runSimulation(input: SimulationInput): Promise<SimulationResult> {
    const { symbol, entryDate, entryPrice, shares, stopPrice, trailPercent, maxDays = 60 } = input;

    this.logger.log(`Running simulation for ${symbol} from ${entryDate}`);

    // Get bars from entry date forward (need ~90 calendar days for 60 trading days)
    const toDate = new Date(entryDate);
    toDate.setDate(toDate.getDate() + Math.ceil(maxDays * 1.5));
    const toDateStr = toDate.toISOString().split('T')[0];

    const bars = await this.polygonService.getBarsForDateRange(
      symbol,
      entryDate,
      toDateStr,
      'day',
    );

    if (bars.length === 0) {
      throw new Error(`No data available for ${symbol} starting ${entryDate}`);
    }

    const events: SimulationEvent[] = [];
    const dailyData: SimulationResult['dailyData'] = [];

    let currentStop = stopPrice;
    let highestClose = entryPrice;
    let exitPrice = 0;
    let exitDate = '';
    let exitReason: SimulationResult['exitReason'] = 'data_ended';
    let daysHeld = 0;

    // Entry event
    events.push({
      day: 0,
      date: entryDate,
      type: 'ENTRY',
      price: entryPrice,
      stopPrice: currentStop,
      note: `Entered at $${entryPrice.toFixed(2)}, stop at $${currentStop.toFixed(2)}`,
    });

    // Process each day
    for (let i = 0; i < bars.length && daysHeld < maxDays; i++) {
      const bar = bars[i];
      const barDate = bar.timestamp.toISOString().split('T')[0];
      daysHeld++;

      // Check if stopped out (low touches stop)
      if (bar.low <= currentStop) {
        exitPrice = currentStop;
        exitDate = barDate;
        exitReason = 'stopped_out';

        events.push({
          day: daysHeld,
          date: barDate,
          type: 'EXIT',
          price: exitPrice,
          stopPrice: currentStop,
          note: `Stopped out at $${exitPrice.toFixed(2)}`,
        });

        dailyData.push({
          date: barDate,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          stopPrice: currentStop,
        });

        break;
      }

      // Update highest close and trail stop
      if (bar.close > highestClose) {
        highestClose = bar.close;
        const newStop = highestClose * (1 - trailPercent);

        if (newStop > currentStop) {
          const oldStop = currentStop;
          currentStop = newStop;

          events.push({
            day: daysHeld,
            date: barDate,
            type: 'STOP_RAISED',
            price: bar.close,
            stopPrice: currentStop,
            note: `New high $${highestClose.toFixed(2)}, stop raised $${oldStop.toFixed(2)} → $${currentStop.toFixed(2)}`,
          });
        }
      }

      dailyData.push({
        date: barDate,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        stopPrice: currentStop,
      });

      // If max days reached
      if (daysHeld >= maxDays) {
        exitPrice = bar.close;
        exitDate = barDate;
        exitReason = 'max_days';

        events.push({
          day: daysHeld,
          date: barDate,
          type: 'EXIT',
          price: exitPrice,
          stopPrice: currentStop,
          note: `Max holding period (${maxDays} days) reached, exited at $${exitPrice.toFixed(2)}`,
        });
      }
    }

    // If we ran out of data before exit
    if (!exitDate && dailyData.length > 0) {
      const lastBar = dailyData[dailyData.length - 1];
      exitPrice = lastBar.close;
      exitDate = lastBar.date;
      exitReason = 'data_ended';

      events.push({
        day: daysHeld,
        date: exitDate,
        type: 'EXIT',
        price: exitPrice,
        stopPrice: currentStop,
        note: `Data ended, final price $${exitPrice.toFixed(2)}`,
      });
    }

    const pnl = (exitPrice - entryPrice) * shares;
    const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;

    this.logger.log(
      `Simulation complete: ${symbol} ${entryDate} → ${exitDate}, ${daysHeld} days, ${pnlPercent.toFixed(2)}%`,
    );

    return {
      symbol,
      entryDate,
      entryPrice,
      exitDate,
      exitPrice,
      exitReason,
      shares,
      daysHeld,
      pnl,
      pnlPercent,
      highestPrice: highestClose,
      events,
      dailyData,
    };
  }
}
```

**Step 3: Create SimulationController**

Create `apps/api/src/simulation/simulation.controller.ts`:

```typescript
import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SimulationService } from './simulation.service';
import { SimulationInput } from './simulation.types';

@Controller('simulation')
@UseGuards(JwtAuthGuard)
export class SimulationController {
  constructor(private readonly simulationService: SimulationService) {}

  @Post('run')
  async runSimulation(@Body() input: SimulationInput) {
    return this.simulationService.runSimulation(input);
  }
}
```

**Step 4: Create SimulationModule**

Create `apps/api/src/simulation/simulation.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { SimulationService } from './simulation.service';
import { SimulationController } from './simulation.controller';
import { DataModule } from '../data/data.module';

@Module({
  imports: [DataModule],
  controllers: [SimulationController],
  providers: [SimulationService],
  exports: [SimulationService],
})
export class SimulationModule {}
```

**Step 5: Register module in AppModule**

In `apps/api/src/app.module.ts`, add import:

```typescript
import { SimulationModule } from './simulation/simulation.module';
```

Add to imports array:

```typescript
SimulationModule,
```

**Step 6: Commit**

```bash
git add apps/api/src/simulation/ apps/api/src/app.module.ts
git commit -m "feat: add SimulationService with trade simulation logic"
```

---

## Task 4: Modify Scanner to Support Historical Dates

**Files:**
- Modify: `apps/api/src/strategy/buy-qualification.service.ts`
- Modify: `apps/api/src/scanner/scanner.service.ts`
- Modify: `apps/api/src/scanner/scanner.controller.ts`

**Step 1: Add asOfDate parameter to BuyQualificationService**

In `apps/api/src/strategy/buy-qualification.service.ts`, modify the `qualify` method signature to accept an optional `asOfDate` parameter:

Find the method that fetches bars and modify to use `getBarsAsOf` when `asOfDate` is provided.

Add parameter to `qualify` method:

```typescript
async qualify(symbol: string, asOfDate?: string): Promise<QualificationResult> {
```

When fetching bars, check for asOfDate:

```typescript
const bars = asOfDate
  ? await this.polygonService.getBarsAsOf(symbol, asOfDate, 220)
  : await this.polygonService.getBars(symbol, 'day', 220);
```

Similarly update `qualifyMultiple`:

```typescript
async qualifyMultiple(symbols: string[], asOfDate?: string): Promise<QualificationResult[]> {
```

**Step 2: Add asOfDate to scanner endpoints**

In `apps/api/src/scanner/scanner.controller.ts`, modify the `triggerScan` endpoint:

```typescript
@Post('scan')
async triggerScan(@Body() body: { symbols?: string[]; asOfDate?: string }) {
  const opportunities = await this.scannerService.manualScan(body.symbols, body.asOfDate);
  return { opportunities };
}
```

**Step 3: Pass asOfDate through ScannerService**

In `apps/api/src/scanner/scanner.service.ts`, modify `manualScan`:

```typescript
async manualScan(symbols?: string[], asOfDate?: string): Promise<Opportunity[]> {
  // ... existing symbol handling ...
  return this.scanWatchlist(asOfDate);
}
```

Modify `scanWatchlist` to accept and pass through `asOfDate`:

```typescript
async scanWatchlist(asOfDate?: string): Promise<Opportunity[]> {
```

Pass to qualification service:

```typescript
const qualificationResults = await this.buyQualificationService.qualifyMultiple(symbols, asOfDate);
```

**Step 4: Commit**

```bash
git add apps/api/src/strategy/buy-qualification.service.ts apps/api/src/scanner/
git commit -m "feat: add historical date support to scanner"
```

---

## Task 5: Add Frontend Simulation Settings

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/app/dashboard/settings/page.tsx`

**Step 1: Add API methods**

In `apps/web/src/lib/api.ts`, add:

```typescript
getSimulationConfig: (token: string) =>
  apiRequest<{ enabled: boolean; date: string | null }>('/safety/simulation', { token }),

updateSimulationConfig: (token: string, config: { enabled?: boolean; date?: string }) =>
  apiRequest<{ success: boolean; config: { enabled: boolean; date: string | null } }>(
    '/safety/simulation',
    { method: 'POST', token, body: config }
  ),

runSimulation: (token: string, input: {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  shares: number;
  stopPrice: number;
  trailPercent: number;
  maxDays?: number;
}) =>
  apiRequest<{
    symbol: string;
    entryDate: string;
    entryPrice: number;
    exitDate: string;
    exitPrice: number;
    exitReason: string;
    shares: number;
    daysHeld: number;
    pnl: number;
    pnlPercent: number;
    highestPrice: number;
    events: Array<{ day: number; date: string; type: string; price: number; stopPrice: number; note?: string }>;
    dailyData: Array<{ date: string; open: number; high: number; low: number; close: number; stopPrice: number }>;
  }>('/simulation/run', { method: 'POST', token, body: input }),
```

Also update `triggerScan` to accept `asOfDate`:

```typescript
triggerScan: (token: string, symbols?: string[], asOfDate?: string) =>
  apiRequest<{ opportunities: unknown[] }>('/scanner/scan', {
    method: 'POST',
    token,
    body: { symbols, asOfDate },
  }),
```

**Step 2: Add Simulation Mode section to Settings page**

In `apps/web/src/app/dashboard/settings/page.tsx`, add state:

```typescript
const [simulationConfig, setSimulationConfig] = useState<{ enabled: boolean; date: string | null } | null>(null);
const [savingSimulation, setSavingSimulation] = useState(false);
```

Update `fetchSettings` to include simulation config:

```typescript
const [dashboardData, configData, simConfig] = await Promise.all([
  api.getDashboard(token),
  api.getAccountConfig(token),
  api.getSimulationConfig(token),
]);
// ... existing sets ...
setSimulationConfig(simConfig);
```

Add save handler:

```typescript
const handleSaveSimulation = async () => {
  if (!token || !simulationConfig) return;
  setSavingSimulation(true);
  try {
    await api.updateSimulationConfig(token, {
      enabled: simulationConfig.enabled,
      date: simulationConfig.date || undefined,
    });
    await fetchSettings();
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to save simulation config');
  } finally {
    setSavingSimulation(false);
  }
};
```

Add UI section (add before the closing tags):

```tsx
{/* Simulation Mode */}
<div className="bg-gray-800 p-4 rounded-lg space-y-4">
  <h3 className="text-lg font-semibold text-white">Simulation Mode</h3>
  <p className="text-sm text-gray-400">
    Enable to backtest trades using historical data. The app will behave as if today is the simulation date.
  </p>

  {simulationConfig && (
    <div className="space-y-4">
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={simulationConfig.enabled}
          onChange={(e) => setSimulationConfig({ ...simulationConfig, enabled: e.target.checked })}
          className="w-5 h-5 rounded bg-gray-700 border-gray-600"
        />
        <span className="text-white">Enable Simulation Mode</span>
      </label>

      {simulationConfig.enabled && (
        <div>
          <label className="block text-sm text-gray-400 mb-1">Simulation Date</label>
          <input
            type="date"
            value={simulationConfig.date || ''}
            onChange={(e) => setSimulationConfig({ ...simulationConfig, date: e.target.value })}
            max={new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
            className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600"
          />
          <p className="text-xs text-gray-500 mt-1">
            Must be at least 60 days in the past for simulation to complete
          </p>
        </div>
      )}

      <button
        onClick={handleSaveSimulation}
        disabled={savingSimulation}
        className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-orange-800 text-white rounded"
      >
        {savingSimulation ? 'Saving...' : 'Save Simulation Settings'}
      </button>
    </div>
  )}
</div>
```

**Step 3: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/app/dashboard/settings/page.tsx
git commit -m "feat: add simulation mode settings to frontend"
```

---

## Task 6: Update Dashboard Header for Simulation Mode

**Files:**
- Modify: `apps/web/src/app/dashboard/layout.tsx`
- Modify: `apps/web/src/lib/store.ts` (if needed for global state)

**Step 1: Fetch simulation config in layout**

In `apps/web/src/app/dashboard/layout.tsx`, add state and fetch:

```typescript
const [simulationMode, setSimulationMode] = useState<{ enabled: boolean; date: string | null } | null>(null);

useEffect(() => {
  if (mounted && token) {
    api.getSimulationConfig(token).then(setSimulationMode).catch(() => {});
  }
}, [mounted, token]);
```

Add import for api:
```typescript
import { api } from '@/lib/api';
```

**Step 2: Update header to show simulation indicator**

Replace the PAPER badge in the header:

```tsx
{simulationMode?.enabled ? (
  <div className="flex items-center gap-2">
    <span className="px-2 py-1 bg-orange-500/20 text-orange-400 text-xs font-medium rounded">
      SIMULATION
    </span>
    <span className="text-orange-400 text-xs">
      {simulationMode.date ? new Date(simulationMode.date).toLocaleDateString() : 'No date set'}
    </span>
  </div>
) : (
  <span className="px-2 py-1 bg-yellow-500/20 text-yellow-500 text-xs font-medium rounded">
    PAPER
  </span>
)}
```

**Step 3: Commit**

```bash
git add apps/web/src/app/dashboard/layout.tsx
git commit -m "feat: show simulation mode indicator in dashboard header"
```

---

## Task 7: Update Opportunities Page for Simulation Mode

**Files:**
- Modify: `apps/web/src/app/dashboard/opportunities/page.tsx`

**Step 1: Add simulation state and fetch config**

Add state:

```typescript
const [simulationConfig, setSimulationConfig] = useState<{ enabled: boolean; date: string | null } | null>(null);
const [simulationResult, setSimulationResult] = useState<any>(null);
const [showSimulationResult, setShowSimulationResult] = useState(false);
const [runningSimulation, setRunningSimulation] = useState(false);
```

Fetch config on mount:

```typescript
useEffect(() => {
  if (token) {
    api.getSimulationConfig(token).then(setSimulationConfig).catch(() => {});
  }
}, [token]);
```

**Step 2: Modify scan to use simulation date**

Update `handleScan`:

```typescript
const handleScan = async () => {
  if (!token) return;
  setScanning(true);
  setScanMessage(null);
  try {
    await api.dedupOpportunities(token);
    const asOfDate = simulationConfig?.enabled ? simulationConfig.date || undefined : undefined;
    const result = await api.triggerScan(token, undefined, asOfDate);
    await fetchOpportunities();
    const count = result.opportunities?.length || 0;
    const dateMsg = asOfDate ? ` for ${asOfDate}` : '';
    setScanMessage(count === 0 ? `Scan complete${dateMsg}. No stocks found.` : `Found ${count} opportunities${dateMsg}`);
    setTimeout(() => setScanMessage(null), 10000);
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Scan failed');
  } finally {
    setScanning(false);
  }
};
```

**Step 3: Modify confirm trade to run simulation when in simulation mode**

Update `handleConfirmApprove`:

```typescript
const handleConfirmApprove = async () => {
  if (!token || !selected || !positionCalc) return;

  // If simulation mode, run simulation instead of approving
  if (simulationConfig?.enabled && simulationConfig.date && positionCalc.status === 'OK') {
    setRunningSimulation(true);
    try {
      const result = await api.runSimulation(token, {
        symbol: selected.symbol,
        entryDate: simulationConfig.date,
        entryPrice: positionCalc.entry,
        shares: positionCalc.shares!,
        stopPrice: positionCalc.stop!,
        trailPercent: positionCalc.stop_pct!,
        maxDays: 60,
      });
      setSimulationResult(result);
      setShowSimulationResult(true);
      setShowConfirmModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation failed');
    } finally {
      setRunningSimulation(false);
    }
    return;
  }

  // Normal approval flow
  try {
    await api.approveOpportunity(token, selected.id);
    await fetchOpportunities();
    setShowConfirmModal(false);
    setPositionCalc(null);
    setSelected(null);
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to approve');
  }
};
```

**Step 4: Update confirm button text in modal**

In the confirmation modal, change the confirm button:

```tsx
<button
  onClick={handleConfirmApprove}
  disabled={runningSimulation}
  className="flex-1 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-800 text-white rounded font-medium"
>
  {runningSimulation ? 'Simulating...' : simulationConfig?.enabled ? 'Run Simulation' : 'Confirm Trade'}
</button>
```

**Step 5: Commit**

```bash
git add apps/web/src/app/dashboard/opportunities/page.tsx
git commit -m "feat: integrate simulation mode into opportunities page"
```

---

## Task 8: Create Simulation Result Modal

**Files:**
- Create: `apps/web/src/components/SimulationResultModal.tsx`
- Modify: `apps/web/src/app/dashboard/opportunities/page.tsx`

**Step 1: Create the modal component**

Create `apps/web/src/components/SimulationResultModal.tsx`:

```typescript
'use client';

import { useEffect, useRef } from 'react';

interface SimulationResult {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  exitReason: string;
  shares: number;
  daysHeld: number;
  pnl: number;
  pnlPercent: number;
  highestPrice: number;
  events: Array<{ day: number; date: string; type: string; price: number; stopPrice: number; note?: string }>;
  dailyData: Array<{ date: string; open: number; high: number; low: number; close: number; stopPrice: number }>;
}

interface Props {
  result: SimulationResult;
  onClose: () => void;
}

export default function SimulationResultModal({ result, onClose }: Props) {
  const isProfitable = result.pnl >= 0;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-700">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-white">Simulation Result: {result.symbol}</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">&times;</button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {/* Summary Card */}
          <div className={`p-4 rounded-lg ${isProfitable ? 'bg-green-500/20 border border-green-500' : 'bg-red-500/20 border border-red-500'}`}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-gray-400 text-xs">Entry</div>
                <div className="text-white font-mono">${result.entryPrice.toFixed(2)}</div>
                <div className="text-gray-500 text-xs">{result.entryDate}</div>
              </div>
              <div>
                <div className="text-gray-400 text-xs">Exit</div>
                <div className="text-white font-mono">${result.exitPrice.toFixed(2)}</div>
                <div className="text-gray-500 text-xs">{result.exitDate}</div>
              </div>
              <div>
                <div className="text-gray-400 text-xs">Days Held</div>
                <div className="text-white font-mono">{result.daysHeld}</div>
              </div>
              <div>
                <div className="text-gray-400 text-xs">P&L</div>
                <div className={`font-mono font-bold ${isProfitable ? 'text-green-400' : 'text-red-400'}`}>
                  {isProfitable ? '+' : ''}${result.pnl.toFixed(2)}
                </div>
                <div className={`text-sm ${isProfitable ? 'text-green-400' : 'text-red-400'}`}>
                  {isProfitable ? '+' : ''}{result.pnlPercent.toFixed(2)}%
                </div>
              </div>
            </div>
            <div className="mt-3 text-center text-sm text-gray-400">
              Exit reason: <span className="text-white">{result.exitReason.replace('_', ' ')}</span>
              {' | '}Shares: <span className="text-white">{result.shares}</span>
              {' | '}Highest: <span className="text-white">${result.highestPrice.toFixed(2)}</span>
            </div>
          </div>

          {/* Event Log */}
          <div className="bg-gray-700/50 rounded-lg p-3">
            <h3 className="text-sm font-semibold text-white mb-2">Event Log</h3>
            <div className="space-y-1 max-h-48 overflow-y-auto font-mono text-xs">
              {result.events.map((event, idx) => (
                <div key={idx} className="flex gap-2 text-gray-300">
                  <span className="text-gray-500 w-12">Day {event.day}</span>
                  <span className={`w-20 ${
                    event.type === 'ENTRY' ? 'text-blue-400' :
                    event.type === 'STOP_RAISED' ? 'text-yellow-400' :
                    'text-red-400'
                  }`}>{event.type}</span>
                  <span className="flex-1">{event.note}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Simple Price Chart */}
          <div className="bg-gray-700/50 rounded-lg p-3">
            <h3 className="text-sm font-semibold text-white mb-2">Price Chart</h3>
            <div className="h-48 flex items-end gap-px">
              {result.dailyData.map((day, idx) => {
                const minPrice = Math.min(...result.dailyData.map(d => d.low));
                const maxPrice = Math.max(...result.dailyData.map(d => d.high));
                const range = maxPrice - minPrice || 1;
                const height = ((day.close - minPrice) / range) * 100;
                const stopHeight = ((day.stopPrice - minPrice) / range) * 100;
                const isUp = day.close >= day.open;

                return (
                  <div key={idx} className="flex-1 relative" title={`${day.date}: $${day.close.toFixed(2)}`}>
                    <div
                      className={`w-full ${isUp ? 'bg-green-500' : 'bg-red-500'}`}
                      style={{ height: `${Math.max(height, 2)}%` }}
                    />
                    <div
                      className="absolute w-full border-t border-red-400"
                      style={{ bottom: `${stopHeight}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>{result.dailyData[0]?.date}</span>
              <span className="text-red-400">— Stop line</span>
              <span>{result.dailyData[result.dailyData.length - 1]?.date}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="w-full py-2 bg-gray-600 hover:bg-gray-500 text-white rounded font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Import and use in opportunities page**

In `apps/web/src/app/dashboard/opportunities/page.tsx`, add import:

```typescript
import SimulationResultModal from '@/components/SimulationResultModal';
```

Add at the end of the component, before the final closing tags:

```tsx
{/* Simulation Result Modal */}
{showSimulationResult && simulationResult && (
  <SimulationResultModal
    result={simulationResult}
    onClose={() => {
      setShowSimulationResult(false);
      setSimulationResult(null);
    }}
  />
)}
```

**Step 3: Commit**

```bash
git add apps/web/src/components/SimulationResultModal.tsx apps/web/src/app/dashboard/opportunities/page.tsx
git commit -m "feat: add simulation result modal with event log and chart"
```

---

## Task 9: Final Integration Testing

**Step 1: Manual testing checklist**

1. Enable simulation mode in Settings with a date ~6 months ago
2. Verify header shows "SIMULATION" badge with date
3. Click Scan - verify it finds opportunities from that date
4. Select an opportunity and click Approve
5. In confirmation modal, verify button says "Run Simulation"
6. Click Run Simulation
7. Verify simulation result modal shows:
   - Summary with entry/exit/P&L
   - Event log with entries
   - Price chart with stop line
8. Close modal and try another trade
9. Disable simulation mode and verify normal trading flow works

**Step 2: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during integration testing"
```

---

## Task 10: Final Verification

**Use skill:** @superpowers:verification-before-completion

1. Run the full app and test simulation mode end-to-end
2. Verify all features work:
   - Settings toggle and date picker
   - Header indicator
   - Historical scan
   - Simulation execution
   - Result display
3. Check for console errors
4. Verify normal mode still works after testing simulation

**Step 1: Commit final state**

```bash
git add -A
git commit -m "feat: complete simulation mode implementation"
```
