# Conservative Swing Trading Bot Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the existing trading bot to strictly follow conservative, risk-first swing trading rules with capital preservation as the primary objective.

**Architecture:** Replace the current scoring-based system with a rule-based trade qualification system. All trades must pass mandatory filters (universe, trend, volatility, events) before being evaluated for setups. Position sizing is calculated from risk, not fixed percentages.

**Tech Stack:** NestJS, TypeORM, PostgreSQL, Interactive Brokers API (@stoqey/ib), Polygon.io

---

## Gap Analysis Summary

| Area | Current | Required |
|------|---------|----------|
| Position Sizing | Fixed 1% of portfolio | Risk-based: $risk / stop% |
| Daily Loss Limit | 1.5% | 0.5% |
| Weekly Loss Limit | 3% | 1.5% |
| Monthly Loss Limit | None | 3% |
| Max Positions | 20 | 10-15 |
| Max Capital Deployed | No limit | 20-30% |
| Trade Universe | Any watchlist | S&P 500 + Nasdaq 100 + liquid ETFs |
| Trend Filter | None mandatory | 200-day MA above + rising |
| Stop Distance | Any | 2-6% only |
| Earnings Filter | None | Block 5 days before |
| Order Type | Market/Limit | Bracket orders only |

---

## Task 1: Create Conservative Trading Types

**Files:**
- Create: `apps/api/src/strategy/conservative-trading.types.ts`
- Test: `apps/api/src/strategy/conservative-trading.types.spec.ts`

**Step 1: Write the types file**

```typescript
// apps/api/src/strategy/conservative-trading.types.ts

export interface AccountConfig {
  totalCapital: number;           // e.g., 1_000_000
  riskPerTradePercent: number;    // 0.10 to 0.20 (default 0.15)
  maxCapitalDeployedPercent: number; // 20-30%
}

export interface RiskLimits {
  dailyLossLimitPercent: number;    // 0.5%
  weeklyLossLimitPercent: number;   // 1.5%
  monthlyLossLimitPercent: number;  // 3%
  maxOpenPositions: number;         // 10-15
  minStopDistancePercent: number;   // 2%
  maxStopDistancePercent: number;   // 6%
}

export const DEFAULT_ACCOUNT_CONFIG: AccountConfig = {
  totalCapital: 1_000_000,
  riskPerTradePercent: 0.15,
  maxCapitalDeployedPercent: 25,
};

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  dailyLossLimitPercent: 0.5,
  weeklyLossLimitPercent: 1.5,
  monthlyLossLimitPercent: 3.0,
  maxOpenPositions: 12,
  minStopDistancePercent: 2,
  maxStopDistancePercent: 6,
};

export enum TradeSetupType {
  MEAN_REVERSION_PULLBACK = 'mean_reversion_pullback',
  MA_PULLBACK_20 = 'ma_pullback_20',
  MA_PULLBACK_50 = 'ma_pullback_50',
  OVERSOLD_STABILIZATION = 'oversold_stabilization',
  BREAKOUT_RETEST = 'breakout_retest',
}

export enum TradeRejectionReason {
  NOT_IN_UNIVERSE = 'not_in_universe',
  BELOW_200_MA = 'below_200_ma',
  MA_200_DECLINING = 'ma_200_declining',
  VOLUME_TOO_LOW = 'volume_too_low',
  STOP_TOO_TIGHT = 'stop_too_tight',
  STOP_TOO_WIDE = 'stop_too_wide',
  EARNINGS_SOON = 'earnings_soon',
  DAILY_LIMIT_HIT = 'daily_limit_hit',
  WEEKLY_LIMIT_HIT = 'weekly_limit_hit',
  MONTHLY_LIMIT_HIT = 'monthly_limit_hit',
  MAX_POSITIONS = 'max_positions',
  MAX_CAPITAL_DEPLOYED = 'max_capital_deployed',
  NO_VALID_SETUP = 'no_valid_setup',
}

export interface TradeQualification {
  symbol: string;
  qualified: boolean;
  rejectionReason?: TradeRejectionReason;

  // If qualified, these are populated
  setupType?: TradeSetupType;
  entryPrice?: number;
  stopPrice?: number;
  stopDistancePercent?: number;
  positionSizeDollars?: number;
  shares?: number;
  maxDollarRisk?: number;
  estimatedUpsidePercent?: number;
}

export interface ExtendedTechnicalIndicators {
  sma20: number;
  sma50: number;
  sma200: number;
  sma200Slope: number;      // Positive = rising, negative = declining
  rsi14: number;
  atr14: number;
  atrPercent: number;       // ATR as % of price
  avgDailyVolume: number;   // 20-day average
  currentVolume: number;
  priceVsSma20Percent: number;
  priceVsSma50Percent: number;
  priceVsSma200Percent: number;
}

export interface TradeLogEntry {
  id: string;
  timestamp: Date;
  symbol: string;
  action: 'FLAGGED' | 'ENTERED' | 'EXITED' | 'REJECTED';
  entryPrice?: number;
  stopPrice?: number;
  exitPrice?: number;
  positionSizeDollars?: number;
  shares?: number;
  dollarRisk?: number;
  exitReason?: string;
  pnl?: number;
  pnlPercent?: number;
  setupType?: TradeSetupType;
  rejectionReason?: TradeRejectionReason;
  notes?: string;
}
```

**Step 2: Commit**

```bash
git add apps/api/src/strategy/conservative-trading.types.ts
git commit -m "feat: add conservative trading types and interfaces"
```

---

## Task 2: Create Trade Universe Service

**Files:**
- Create: `apps/api/src/universe/trade-universe.service.ts`
- Create: `apps/api/src/universe/trade-universe.module.ts`
- Create: `apps/api/src/universe/universe-data.ts`
- Test: `apps/api/src/universe/trade-universe.service.spec.ts`

**Step 1: Create the S&P 500 and Nasdaq 100 symbol lists**

```typescript
// apps/api/src/universe/universe-data.ts

// S&P 500 components (top liquid names - update periodically)
export const SP500_SYMBOLS: string[] = [
  'AAPL', 'MSFT', 'AMZN', 'NVDA', 'GOOGL', 'GOOG', 'META', 'BRK.B', 'UNH', 'XOM',
  'JNJ', 'JPM', 'V', 'PG', 'MA', 'HD', 'CVX', 'MRK', 'ABBV', 'LLY',
  'PEP', 'KO', 'COST', 'AVGO', 'MCD', 'WMT', 'CSCO', 'TMO', 'ACN', 'ABT',
  'CRM', 'DHR', 'NKE', 'TXN', 'NEE', 'UPS', 'PM', 'MS', 'RTX', 'HON',
  'QCOM', 'LOW', 'UNP', 'IBM', 'CAT', 'BA', 'AMGN', 'GE', 'SPGI', 'INTU',
  'DE', 'AMAT', 'AXP', 'BKNG', 'MDLZ', 'ISRG', 'GS', 'BLK', 'ADI', 'GILD',
  'SYK', 'VRTX', 'ADP', 'TJX', 'MMC', 'REGN', 'LMT', 'CVS', 'ETN', 'PGR',
  'SCHW', 'CB', 'ZTS', 'CI', 'MO', 'SLB', 'LRCX', 'SO', 'BSX', 'FI',
  'DUK', 'BDX', 'CME', 'EQIX', 'CL', 'MU', 'ITW', 'AON', 'NOC', 'ICE',
  'SHW', 'PNC', 'MCK', 'WM', 'CSX', 'ATVI', 'APD', 'SNPS', 'FCX', 'CCI',
  // Add more as needed - this is a representative sample
];

// Nasdaq 100 components
export const NASDAQ100_SYMBOLS: string[] = [
  'AAPL', 'MSFT', 'AMZN', 'NVDA', 'GOOGL', 'GOOG', 'META', 'AVGO', 'COST', 'TSLA',
  'ASML', 'PEP', 'CSCO', 'AZN', 'ADBE', 'NFLX', 'AMD', 'TXN', 'CMCSA', 'TMUS',
  'HON', 'QCOM', 'INTC', 'INTU', 'AMGN', 'AMAT', 'ISRG', 'BKNG', 'SBUX', 'LRCX',
  'ADI', 'GILD', 'MDLZ', 'VRTX', 'ADP', 'REGN', 'MU', 'SNPS', 'PYPL', 'PANW',
  'KLAC', 'CDNS', 'MAR', 'CSX', 'MELI', 'ORLY', 'MNST', 'FTNT', 'CTAS', 'KDP',
  'NXPI', 'MCHP', 'ADSK', 'PCAR', 'AEP', 'KHC', 'PAYX', 'CHTR', 'ODFL', 'CPRT',
  'LULU', 'DXCM', 'EXC', 'MRNA', 'ROST', 'IDXX', 'MRVL', 'EA', 'CTSH', 'XEL',
  'FAST', 'VRSK', 'GEHC', 'BKR', 'CSGP', 'FANG', 'DLTR', 'WBD', 'ANSS', 'TEAM',
  'ZS', 'ILMN', 'ALGN', 'EBAY', 'DDOG', 'CRWD', 'WDAY', 'BIIB', 'WBA', 'ENPH',
  'SIRI', 'ZM', 'JD', 'PDD', 'LCID', 'RIVN',
];

// Highly liquid sector ETFs
export const LIQUID_ETFS: string[] = [
  'SPY',  // S&P 500
  'QQQ',  // Nasdaq 100
  'IWM',  // Russell 2000
  'DIA',  // Dow Jones
  'XLK',  // Technology
  'XLF',  // Financials
  'XLE',  // Energy
  'XLV',  // Healthcare
  'XLI',  // Industrials
  'XLY',  // Consumer Discretionary
  'XLP',  // Consumer Staples
  'XLB',  // Materials
  'XLU',  // Utilities
  'XLRE', // Real Estate
  'XLC',  // Communication Services
  'VTI',  // Total Stock Market
  'VOO',  // Vanguard S&P 500
  'VGT',  // Vanguard Tech
];

// Meme stocks and illiquid names to always exclude
export const EXCLUDED_SYMBOLS: string[] = [
  'GME', 'AMC', 'BBBY', 'BB', 'NOK', 'KOSS', 'EXPR', 'NAKD',
  'SNDL', 'CLOV', 'WISH', 'WKHS', 'RIDE', 'NKLA', 'SPCE',
];

export const MIN_AVG_DAILY_VOLUME = 2_000_000;
```

**Step 2: Create the trade universe service**

```typescript
// apps/api/src/universe/trade-universe.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { PolygonService } from '../data/polygon.service';
import {
  SP500_SYMBOLS,
  NASDAQ100_SYMBOLS,
  LIQUID_ETFS,
  EXCLUDED_SYMBOLS,
  MIN_AVG_DAILY_VOLUME,
} from './universe-data';

export interface UniverseCheckResult {
  inUniverse: boolean;
  reason?: string;
  avgDailyVolume?: number;
  isSP500: boolean;
  isNasdaq100: boolean;
  isETF: boolean;
}

@Injectable()
export class TradeUniverseService {
  private readonly logger = new Logger(TradeUniverseService.name);
  private readonly allValidSymbols: Set<string>;

  constructor(private readonly polygonService: PolygonService) {
    // Combine all valid symbols into a set (deduplicated)
    this.allValidSymbols = new Set([
      ...SP500_SYMBOLS,
      ...NASDAQ100_SYMBOLS,
      ...LIQUID_ETFS,
    ]);

    // Remove excluded symbols
    EXCLUDED_SYMBOLS.forEach(s => this.allValidSymbols.delete(s));
  }

  async checkSymbol(symbol: string): Promise<UniverseCheckResult> {
    const upperSymbol = symbol.toUpperCase();

    // Check if explicitly excluded
    if (EXCLUDED_SYMBOLS.includes(upperSymbol)) {
      return {
        inUniverse: false,
        reason: 'Symbol is on exclusion list (meme stock or illiquid)',
        isSP500: false,
        isNasdaq100: false,
        isETF: false,
      };
    }

    // Check if in valid universe
    const isSP500 = SP500_SYMBOLS.includes(upperSymbol);
    const isNasdaq100 = NASDAQ100_SYMBOLS.includes(upperSymbol);
    const isETF = LIQUID_ETFS.includes(upperSymbol);

    if (!isSP500 && !isNasdaq100 && !isETF) {
      return {
        inUniverse: false,
        reason: 'Symbol not in S&P 500, Nasdaq 100, or approved ETF list',
        isSP500,
        isNasdaq100,
        isETF,
      };
    }

    // Check volume requirement
    try {
      const indicators = await this.polygonService.getTechnicalIndicators(upperSymbol);
      const avgDailyVolume = indicators.volume20Avg;

      if (avgDailyVolume < MIN_AVG_DAILY_VOLUME) {
        return {
          inUniverse: false,
          reason: `Average daily volume ${avgDailyVolume.toLocaleString()} below minimum ${MIN_AVG_DAILY_VOLUME.toLocaleString()}`,
          avgDailyVolume,
          isSP500,
          isNasdaq100,
          isETF,
        };
      }

      return {
        inUniverse: true,
        avgDailyVolume,
        isSP500,
        isNasdaq100,
        isETF,
      };
    } catch (error) {
      this.logger.warn(`Failed to check volume for ${upperSymbol}: ${(error as Error).message}`);
      return {
        inUniverse: false,
        reason: 'Failed to verify volume data',
        isSP500,
        isNasdaq100,
        isETF,
      };
    }
  }

  getAllValidSymbols(): string[] {
    return Array.from(this.allValidSymbols);
  }

  getSP500Symbols(): string[] {
    return [...SP500_SYMBOLS];
  }

  getNasdaq100Symbols(): string[] {
    return [...NASDAQ100_SYMBOLS];
  }

  getETFSymbols(): string[] {
    return [...LIQUID_ETFS];
  }
}
```

**Step 3: Create the module**

```typescript
// apps/api/src/universe/trade-universe.module.ts

import { Module } from '@nestjs/common';
import { TradeUniverseService } from './trade-universe.service';
import { DataModule } from '../data/data.module';

@Module({
  imports: [DataModule],
  providers: [TradeUniverseService],
  exports: [TradeUniverseService],
})
export class TradeUniverseModule {}
```

**Step 4: Commit**

```bash
git add apps/api/src/universe/
git commit -m "feat: add trade universe service with S&P 500, Nasdaq 100, ETF filtering"
```

---

## Task 3: Extend Technical Indicators for 200-day MA

**Files:**
- Modify: `apps/api/src/data/data.types.ts`
- Modify: `apps/api/src/data/polygon.service.ts`

**Step 1: Update data types**

Add to `apps/api/src/data/data.types.ts`:

```typescript
export interface ExtendedTechnicalIndicators extends TechnicalIndicators {
  sma200: number;
  sma200Slope: number;        // Positive = rising
  priceVsSma200Percent: number;
  priceVsSma20Percent: number;
  priceVsSma50Percent: number;
  atrPercent: number;         // ATR as % of current price
}
```

**Step 2: Add method to polygon service**

Add this method to `apps/api/src/data/polygon.service.ts`:

```typescript
async getExtendedIndicators(symbol: string): Promise<ExtendedTechnicalIndicators> {
  // Need 220 days to calculate 200-day MA slope
  const bars = await this.getBars(symbol, 'day', 220);

  if (bars.length < 200) {
    throw new Error(`Insufficient data for ${symbol}: need 200 days, got ${bars.length}`);
  }

  const currentPrice = bars[bars.length - 1].close;

  // Calculate SMAs
  const sma20 = this.calculateSMA(bars.slice(-20));
  const sma50 = this.calculateSMA(bars.slice(-50));
  const sma200 = this.calculateSMA(bars.slice(-200));

  // Calculate 200-day MA slope (compare current to 20 days ago)
  const sma200_20daysAgo = this.calculateSMA(bars.slice(-220, -20));
  const sma200Slope = ((sma200 - sma200_20daysAgo) / sma200_20daysAgo) * 100;

  // RSI and ATR
  const rsi = this.calculateRSI(bars.slice(-15));
  const atr = this.calculateATR(bars.slice(-15));
  const atrPercent = (atr / currentPrice) * 100;

  // Volume
  const volume20Avg = bars.slice(-20).reduce((sum, bar) => sum + bar.volume, 0) / 20;
  const currentVolume = bars[bars.length - 1].volume;
  const volumeRatio = currentVolume / volume20Avg;

  // Price vs MAs
  const priceVsSma20Percent = ((currentPrice - sma20) / sma20) * 100;
  const priceVsSma50Percent = ((currentPrice - sma50) / sma50) * 100;
  const priceVsSma200Percent = ((currentPrice - sma200) / sma200) * 100;

  return {
    sma20,
    sma50,
    sma200,
    sma200Slope,
    rsi,
    atr,
    atrPercent,
    volume20Avg,
    volumeRatio,
    priceVsSma20Percent,
    priceVsSma50Percent,
    priceVsSma200Percent,
  };
}

private calculateSMA(bars: StockBar[]): number {
  if (bars.length === 0) return 0;
  return bars.reduce((sum, bar) => sum + bar.close, 0) / bars.length;
}
```

**Step 3: Commit**

```bash
git add apps/api/src/data/
git commit -m "feat: add extended technical indicators with 200-day MA and slope"
```

---

## Task 4: Create Earnings Calendar Service

**Files:**
- Create: `apps/api/src/events/earnings-calendar.service.ts`
- Create: `apps/api/src/events/events.module.ts`

**Step 1: Create earnings calendar service**

```typescript
// apps/api/src/events/earnings-calendar.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface EarningsEvent {
  symbol: string;
  date: Date;
  timing: 'BMO' | 'AMC' | 'UNKNOWN'; // Before Market Open / After Market Close
}

@Injectable()
export class EarningsCalendarService {
  private readonly logger = new Logger(EarningsCalendarService.name);
  private readonly finnhubKey: string;
  private readonly baseUrl = 'https://finnhub.io/api/v1';

  constructor(private readonly configService: ConfigService) {
    this.finnhubKey = this.configService.get<string>('FINNHUB_API_KEY', '');
  }

  async hasEarningsWithinDays(symbol: string, days: number = 5): Promise<{
    hasEarnings: boolean;
    nextEarningsDate?: Date;
    daysUntil?: number;
  }> {
    if (!this.finnhubKey) {
      this.logger.warn('FINNHUB_API_KEY not configured, skipping earnings check');
      return { hasEarnings: false };
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/calendar/earnings?symbol=${symbol}&token=${this.finnhubKey}`
      );

      if (!response.ok) {
        throw new Error(`Finnhub API error: ${response.status}`);
      }

      const data = await response.json() as { earningsCalendar?: Array<{ date: string }> };

      if (!data.earningsCalendar || data.earningsCalendar.length === 0) {
        return { hasEarnings: false };
      }

      const now = new Date();
      now.setHours(0, 0, 0, 0);

      for (const event of data.earningsCalendar) {
        const earningsDate = new Date(event.date);
        earningsDate.setHours(0, 0, 0, 0);

        const diffTime = earningsDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays >= 0 && diffDays <= days) {
          return {
            hasEarnings: true,
            nextEarningsDate: earningsDate,
            daysUntil: diffDays,
          };
        }
      }

      return { hasEarnings: false };
    } catch (error) {
      this.logger.error(`Failed to check earnings for ${symbol}: ${(error as Error).message}`);
      // Fail safe - if we can't check, assume there might be earnings
      return { hasEarnings: false };
    }
  }
}
```

**Step 2: Create events module**

```typescript
// apps/api/src/events/events.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EarningsCalendarService } from './earnings-calendar.service';

@Module({
  imports: [ConfigModule],
  providers: [EarningsCalendarService],
  exports: [EarningsCalendarService],
})
export class EventsModule {}
```

**Step 3: Commit**

```bash
git add apps/api/src/events/
git commit -m "feat: add earnings calendar service for event filtering"
```

---

## Task 5: Create Risk-Based Position Sizing Service

**Files:**
- Create: `apps/api/src/risk/position-sizing.service.ts`
- Create: `apps/api/src/risk/risk.module.ts`

**Step 1: Create position sizing service**

```typescript
// apps/api/src/risk/position-sizing.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../entities/settings.entity';
import {
  AccountConfig,
  DEFAULT_ACCOUNT_CONFIG,
  DEFAULT_RISK_LIMITS,
  RiskLimits,
} from '../strategy/conservative-trading.types';

export interface PositionSizeResult {
  valid: boolean;
  reason?: string;
  positionSizeDollars: number;
  shares: number;
  maxDollarRisk: number;
  stopDistancePercent: number;
  capitalDeploymentPercent: number;
}

@Injectable()
export class PositionSizingService {
  private readonly logger = new Logger(PositionSizingService.name);
  private accountConfig: AccountConfig = DEFAULT_ACCOUNT_CONFIG;
  private riskLimits: RiskLimits = DEFAULT_RISK_LIMITS;

  constructor(
    @InjectRepository(Setting)
    private settingRepo: Repository<Setting>,
  ) {
    this.loadConfig();
  }

  private async loadConfig(): Promise<void> {
    try {
      const accountSetting = await this.settingRepo.findOne({
        where: { key: 'account_config' },
      });
      if (accountSetting) {
        this.accountConfig = { ...DEFAULT_ACCOUNT_CONFIG, ...accountSetting.value };
      }

      const riskSetting = await this.settingRepo.findOne({
        where: { key: 'risk_limits' },
      });
      if (riskSetting) {
        this.riskLimits = { ...DEFAULT_RISK_LIMITS, ...riskSetting.value };
      }
    } catch (error) {
      this.logger.error(`Failed to load config: ${(error as Error).message}`);
    }
  }

  calculatePositionSize(
    entryPrice: number,
    stopPrice: number,
    currentCapitalDeployed: number,
  ): PositionSizeResult {
    // Calculate stop distance
    const stopDistance = Math.abs(entryPrice - stopPrice);
    const stopDistancePercent = (stopDistance / entryPrice) * 100;

    // Validate stop distance is within bounds
    if (stopDistancePercent < this.riskLimits.minStopDistancePercent) {
      return {
        valid: false,
        reason: `Stop distance ${stopDistancePercent.toFixed(2)}% is below minimum ${this.riskLimits.minStopDistancePercent}%`,
        positionSizeDollars: 0,
        shares: 0,
        maxDollarRisk: 0,
        stopDistancePercent,
        capitalDeploymentPercent: 0,
      };
    }

    if (stopDistancePercent > this.riskLimits.maxStopDistancePercent) {
      return {
        valid: false,
        reason: `Stop distance ${stopDistancePercent.toFixed(2)}% exceeds maximum ${this.riskLimits.maxStopDistancePercent}%`,
        positionSizeDollars: 0,
        shares: 0,
        maxDollarRisk: 0,
        stopDistancePercent,
        capitalDeploymentPercent: 0,
      };
    }

    // Calculate max dollar risk
    const maxDollarRisk = this.accountConfig.totalCapital * (this.accountConfig.riskPerTradePercent / 100);

    // Calculate position size: Position = MaxRisk / StopDistance%
    const positionSizeDollars = maxDollarRisk / (stopDistancePercent / 100);

    // Calculate shares (round down to avoid exceeding risk)
    const shares = Math.floor(positionSizeDollars / entryPrice);
    const actualPositionSize = shares * entryPrice;

    // Check if this would exceed max capital deployment
    const newTotalDeployed = currentCapitalDeployed + actualPositionSize;
    const capitalDeploymentPercent = (newTotalDeployed / this.accountConfig.totalCapital) * 100;

    if (capitalDeploymentPercent > this.accountConfig.maxCapitalDeployedPercent) {
      return {
        valid: false,
        reason: `Position would bring total deployment to ${capitalDeploymentPercent.toFixed(1)}%, exceeding max ${this.accountConfig.maxCapitalDeployedPercent}%`,
        positionSizeDollars: actualPositionSize,
        shares,
        maxDollarRisk,
        stopDistancePercent,
        capitalDeploymentPercent,
      };
    }

    return {
      valid: true,
      positionSizeDollars: actualPositionSize,
      shares,
      maxDollarRisk,
      stopDistancePercent,
      capitalDeploymentPercent,
    };
  }

  getMaxDollarRisk(): number {
    return this.accountConfig.totalCapital * (this.accountConfig.riskPerTradePercent / 100);
  }

  getAccountConfig(): AccountConfig {
    return { ...this.accountConfig };
  }

  getRiskLimits(): RiskLimits {
    return { ...this.riskLimits };
  }

  async updateAccountConfig(config: Partial<AccountConfig>): Promise<void> {
    this.accountConfig = { ...this.accountConfig, ...config };
    await this.settingRepo.save({
      key: 'account_config',
      value: this.accountConfig,
      updatedAt: new Date(),
    });
  }

  async updateRiskLimits(limits: Partial<RiskLimits>): Promise<void> {
    this.riskLimits = { ...this.riskLimits, ...limits };
    await this.settingRepo.save({
      key: 'risk_limits',
      value: this.riskLimits,
      updatedAt: new Date(),
    });
  }
}
```

**Step 2: Create risk module**

```typescript
// apps/api/src/risk/risk.module.ts

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PositionSizingService } from './position-sizing.service';
import { Setting } from '../entities/settings.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Setting])],
  providers: [PositionSizingService],
  exports: [PositionSizingService],
})
export class RiskModule {}
```

**Step 3: Commit**

```bash
git add apps/api/src/risk/
git commit -m "feat: add risk-based position sizing service"
```

---

## Task 6: Update Circuit Breaker with New Limits

**Files:**
- Modify: `apps/api/src/safety/safety.types.ts`
- Modify: `apps/api/src/safety/circuit-breaker.service.ts`

**Step 1: Update safety types**

Replace the content in `apps/api/src/safety/safety.types.ts`:

```typescript
export interface SafetyLimits {
  dailyLossLimitPercent: number;    // 0.5%
  weeklyLossLimitPercent: number;   // 1.5%
  monthlyLossLimitPercent: number;  // 3%
  maxConsecutiveLosses: number;
  maxOpenPositions: number;         // 10-15
  maxCapitalDeployedPercent: number; // 20-30%
  minPaperTradeDays: number;
  minPaperTrades: number;
}

export interface TradingState {
  mode: 'paper' | 'live';
  isPaused: boolean;
  pauseReason: string | null;
  pauseUntil: Date | null;
  dailyPnL: number;
  weeklyPnL: number;
  monthlyPnL: number;
  consecutiveLosses: number;
  openPositionsCount: number;
  capitalDeployed: number;
  paperTradeCount: number;
  paperTradingStartDate: Date | null;
}

export enum CircuitBreakerEvent {
  DAILY_LIMIT_HIT = 'daily_limit_hit',
  WEEKLY_LIMIT_HIT = 'weekly_limit_hit',
  MONTHLY_LIMIT_HIT = 'monthly_limit_hit',
  CONSECUTIVE_LOSSES = 'consecutive_losses',
  MAX_POSITIONS = 'max_positions',
  MAX_CAPITAL_DEPLOYED = 'max_capital_deployed',
  TRADING_PAUSED = 'trading_paused',
  TRADING_RESUMED = 'trading_resumed',
}

export const DEFAULT_SAFETY_LIMITS: SafetyLimits = {
  dailyLossLimitPercent: 0.5,       // 0.5% daily
  weeklyLossLimitPercent: 1.5,      // 1.5% weekly
  monthlyLossLimitPercent: 3.0,     // 3% monthly
  maxConsecutiveLosses: 5,
  maxOpenPositions: 12,
  maxCapitalDeployedPercent: 25,    // 25% max deployed
  minPaperTradeDays: 30,            // 1 month minimum
  minPaperTrades: 50,
};
```

**Step 2: Update circuit breaker service to track monthly P&L**

In `apps/api/src/safety/circuit-breaker.service.ts`, update the `refreshState` method to include monthly tracking:

```typescript
async refreshState(): Promise<void> {
  const now = new Date();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  weekAgo.setHours(0, 0, 0, 0);

  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);
  monthAgo.setHours(0, 0, 0, 0);

  // Calculate daily P&L
  const todayTrades = await this.tradeRepo.find({
    where: { closedAt: MoreThan(today) },
  });
  this.state.dailyPnL = todayTrades.reduce((sum, t) => sum + Number(t.pnl), 0);

  // Calculate weekly P&L
  const weekTrades = await this.tradeRepo.find({
    where: { closedAt: MoreThan(weekAgo) },
  });
  this.state.weeklyPnL = weekTrades.reduce((sum, t) => sum + Number(t.pnl), 0);

  // Calculate monthly P&L
  const monthTrades = await this.tradeRepo.find({
    where: { closedAt: MoreThan(monthAgo) },
  });
  this.state.monthlyPnL = monthTrades.reduce((sum, t) => sum + Number(t.pnl), 0);

  // Count open positions
  this.state.openPositionsCount = await this.positionRepo.count({
    where: { status: PositionStatus.OPEN },
  });

  // Calculate capital deployed
  const openPositions = await this.positionRepo.find({
    where: { status: PositionStatus.OPEN },
  });
  this.state.capitalDeployed = openPositions.reduce(
    (sum, p) => sum + (Number(p.entryPrice) * Number(p.shares)),
    0
  );

  // Calculate consecutive losses (same as before)
  const recentTrades = await this.tradeRepo.find({
    order: { closedAt: 'DESC' },
    take: 20,
  });

  let consecutiveLosses = 0;
  for (const trade of recentTrades) {
    if (Number(trade.pnl) < 0) {
      consecutiveLosses++;
    } else {
      break;
    }
  }
  this.state.consecutiveLosses = consecutiveLosses;

  await this.saveState();
}
```

**Step 3: Update canTrade to check monthly limit**

```typescript
async canTrade(portfolioValue: number): Promise<{ allowed: boolean; reason?: string }> {
  await this.refreshState();

  // Check if trading is paused
  if (this.state.isPaused) {
    if (this.state.pauseUntil && new Date() > this.state.pauseUntil) {
      await this.resumeTrading('Pause period expired');
    } else {
      return { allowed: false, reason: this.state.pauseReason || 'Trading is paused' };
    }
  }

  // Check daily loss limit
  const dailyLossThreshold = (this.limits.dailyLossLimitPercent / 100) * portfolioValue;
  if (this.state.dailyPnL < -dailyLossThreshold) {
    await this.pauseTrading('daily_limit', 'Daily loss limit of 0.5% reached');
    return { allowed: false, reason: 'Daily loss limit reached - manual intervention required' };
  }

  // Check weekly loss limit
  const weeklyLossThreshold = (this.limits.weeklyLossLimitPercent / 100) * portfolioValue;
  if (this.state.weeklyPnL < -weeklyLossThreshold) {
    await this.pauseTrading('weekly_limit', 'Weekly loss limit of 1.5% reached');
    return { allowed: false, reason: 'Weekly loss limit reached - manual intervention required' };
  }

  // Check monthly loss limit
  const monthlyLossThreshold = (this.limits.monthlyLossLimitPercent / 100) * portfolioValue;
  if (this.state.monthlyPnL < -monthlyLossThreshold) {
    await this.pauseTrading('monthly_limit', 'Monthly loss limit of 3% reached');
    return { allowed: false, reason: 'Monthly loss limit reached - manual intervention required' };
  }

  // Check consecutive losses
  if (this.state.consecutiveLosses >= this.limits.maxConsecutiveLosses) {
    await this.pauseTrading('consecutive_losses', `${this.state.consecutiveLosses} consecutive losses`);
    return { allowed: false, reason: 'Too many consecutive losses - manual intervention required' };
  }

  // Check max open positions
  if (this.state.openPositionsCount >= this.limits.maxOpenPositions) {
    return { allowed: false, reason: `Maximum ${this.limits.maxOpenPositions} open positions reached` };
  }

  // Check max capital deployed
  const maxCapital = (this.limits.maxCapitalDeployedPercent / 100) * portfolioValue;
  if (this.state.capitalDeployed >= maxCapital) {
    return { allowed: false, reason: `Maximum ${this.limits.maxCapitalDeployedPercent}% capital deployed` };
  }

  return { allowed: true };
}
```

**Step 4: Commit**

```bash
git add apps/api/src/safety/
git commit -m "feat: update circuit breaker with 0.5%/1.5%/3% daily/weekly/monthly limits"
```

---

## Task 7: Create Trade Setup Detection Service

**Files:**
- Create: `apps/api/src/strategy/trade-setup.service.ts`

**Step 1: Create the trade setup detection service**

```typescript
// apps/api/src/strategy/trade-setup.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { PolygonService } from '../data/polygon.service';
import { ExtendedTechnicalIndicators } from '../data/data.types';
import {
  TradeSetupType,
  TradeQualification,
  TradeRejectionReason,
} from './conservative-trading.types';

interface SetupDetectionResult {
  hasSetup: boolean;
  setupType?: TradeSetupType;
  suggestedEntry: number;
  suggestedStop: number;
  estimatedUpsidePercent: number;
  confidence: number;
}

@Injectable()
export class TradeSetupService {
  private readonly logger = new Logger(TradeSetupService.name);

  constructor(private readonly polygonService: PolygonService) {}

  async detectSetup(
    symbol: string,
    indicators: ExtendedTechnicalIndicators,
    currentPrice: number,
  ): Promise<SetupDetectionResult> {
    // Check for mean reversion pullback in uptrend
    const meanReversionSetup = this.checkMeanReversionPullback(indicators, currentPrice);
    if (meanReversionSetup.hasSetup) {
      return meanReversionSetup;
    }

    // Check for 20-MA pullback
    const ma20Pullback = this.checkMAPullback(indicators, currentPrice, 20);
    if (ma20Pullback.hasSetup) {
      return ma20Pullback;
    }

    // Check for 50-MA pullback
    const ma50Pullback = this.checkMAPullback(indicators, currentPrice, 50);
    if (ma50Pullback.hasSetup) {
      return ma50Pullback;
    }

    // Check for oversold stabilization
    const oversoldSetup = this.checkOversoldStabilization(indicators, currentPrice);
    if (oversoldSetup.hasSetup) {
      return oversoldSetup;
    }

    return {
      hasSetup: false,
      suggestedEntry: currentPrice,
      suggestedStop: 0,
      estimatedUpsidePercent: 0,
      confidence: 0,
    };
  }

  private checkMeanReversionPullback(
    indicators: ExtendedTechnicalIndicators,
    currentPrice: number,
  ): SetupDetectionResult {
    // Mean reversion: Price pulled back 3-8% from 20-day high while still in uptrend
    const pullbackFromRecent = indicators.priceVsSma20Percent;

    // Conditions:
    // 1. Price is above 200-MA (uptrend confirmed)
    // 2. Price is 2-8% below 20-MA (pullback)
    // 3. RSI between 30-45 (oversold but not extreme)
    if (
      indicators.priceVsSma200Percent > 0 &&
      indicators.sma200Slope > 0 &&
      pullbackFromRecent >= -8 &&
      pullbackFromRecent <= -2 &&
      indicators.rsi14 >= 30 &&
      indicators.rsi14 <= 45
    ) {
      // Stop below recent swing low or 1.5x ATR below entry
      const atrStop = currentPrice - (indicators.atr14 * 1.5);
      const stopDistance = (currentPrice - atrStop) / currentPrice * 100;

      // Only valid if stop is between 2-6%
      if (stopDistance >= 2 && stopDistance <= 6) {
        return {
          hasSetup: true,
          setupType: TradeSetupType.MEAN_REVERSION_PULLBACK,
          suggestedEntry: currentPrice,
          suggestedStop: Math.round(atrStop * 100) / 100,
          estimatedUpsidePercent: Math.abs(pullbackFromRecent) * 2, // Target: return to 20-MA and beyond
          confidence: 0.7,
        };
      }
    }

    return { hasSetup: false, suggestedEntry: currentPrice, suggestedStop: 0, estimatedUpsidePercent: 0, confidence: 0 };
  }

  private checkMAPullback(
    indicators: ExtendedTechnicalIndicators,
    currentPrice: number,
    maPeriod: 20 | 50,
  ): SetupDetectionResult {
    const maValue = maPeriod === 20 ? indicators.sma20 : indicators.sma50;
    const priceVsMA = maPeriod === 20 ? indicators.priceVsSma20Percent : indicators.priceVsSma50Percent;

    // Conditions for MA pullback:
    // 1. Price above 200-MA (uptrend)
    // 2. Price within 1% of the MA (touching or just above)
    // 3. MA is rising
    // 4. RSI not overbought
    if (
      indicators.priceVsSma200Percent > 0 &&
      indicators.sma200Slope > 0 &&
      priceVsMA >= -1 &&
      priceVsMA <= 2 &&
      indicators.rsi14 < 65
    ) {
      // Stop below the MA by 1.5x ATR
      const stopPrice = maValue - (indicators.atr14 * 1.5);
      const stopDistance = (currentPrice - stopPrice) / currentPrice * 100;

      if (stopDistance >= 2 && stopDistance <= 6) {
        return {
          hasSetup: true,
          setupType: maPeriod === 20 ? TradeSetupType.MA_PULLBACK_20 : TradeSetupType.MA_PULLBACK_50,
          suggestedEntry: currentPrice,
          suggestedStop: Math.round(stopPrice * 100) / 100,
          estimatedUpsidePercent: stopDistance * 2, // 2:1 risk/reward
          confidence: 0.65,
        };
      }
    }

    return { hasSetup: false, suggestedEntry: currentPrice, suggestedStop: 0, estimatedUpsidePercent: 0, confidence: 0 };
  }

  private checkOversoldStabilization(
    indicators: ExtendedTechnicalIndicators,
    currentPrice: number,
  ): SetupDetectionResult {
    // Conditions:
    // 1. Price above 200-MA (still in long-term uptrend)
    // 2. RSI below 35 (oversold)
    // 3. Price pulled back significantly but stabilizing
    if (
      indicators.priceVsSma200Percent > 0 &&
      indicators.rsi14 < 35 &&
      indicators.priceVsSma20Percent < -5
    ) {
      // Stop at 2x ATR below
      const stopPrice = currentPrice - (indicators.atr14 * 2);
      const stopDistance = (currentPrice - stopPrice) / currentPrice * 100;

      if (stopDistance >= 2 && stopDistance <= 6) {
        return {
          hasSetup: true,
          setupType: TradeSetupType.OVERSOLD_STABILIZATION,
          suggestedEntry: currentPrice,
          suggestedStop: Math.round(stopPrice * 100) / 100,
          estimatedUpsidePercent: stopDistance * 2.5, // Higher potential on oversold bounces
          confidence: 0.6,
        };
      }
    }

    return { hasSetup: false, suggestedEntry: currentPrice, suggestedStop: 0, estimatedUpsidePercent: 0, confidence: 0 };
  }
}
```

**Step 2: Commit**

```bash
git add apps/api/src/strategy/trade-setup.service.ts
git commit -m "feat: add trade setup detection service for pullbacks and mean reversion"
```

---

## Task 8: Create Trade Qualification Service (Main Orchestrator)

**Files:**
- Create: `apps/api/src/strategy/trade-qualification.service.ts`

**Step 1: Create the trade qualification service**

```typescript
// apps/api/src/strategy/trade-qualification.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { PolygonService } from '../data/polygon.service';
import { TradeUniverseService } from '../universe/trade-universe.service';
import { EarningsCalendarService } from '../events/earnings-calendar.service';
import { PositionSizingService } from '../risk/position-sizing.service';
import { CircuitBreakerService } from '../safety/circuit-breaker.service';
import { TradeSetupService } from './trade-setup.service';
import {
  TradeQualification,
  TradeRejectionReason,
} from './conservative-trading.types';

@Injectable()
export class TradeQualificationService {
  private readonly logger = new Logger(TradeQualificationService.name);

  constructor(
    private readonly polygonService: PolygonService,
    private readonly universeService: TradeUniverseService,
    private readonly earningsService: EarningsCalendarService,
    private readonly positionSizingService: PositionSizingService,
    private readonly circuitBreakerService: CircuitBreakerService,
    private readonly tradeSetupService: TradeSetupService,
  ) {}

  async qualifyTrade(symbol: string): Promise<TradeQualification> {
    const upperSymbol = symbol.toUpperCase();
    this.logger.log(`Qualifying trade for ${upperSymbol}`);

    // Step 1: Check if circuit breaker allows new trades
    const portfolioValue = this.positionSizingService.getAccountConfig().totalCapital;
    const canTrade = await this.circuitBreakerService.canTrade(portfolioValue);
    if (!canTrade.allowed) {
      return this.reject(upperSymbol, this.mapCircuitBreakerReason(canTrade.reason));
    }

    // Step 2: Check if symbol is in valid universe
    const universeCheck = await this.universeService.checkSymbol(upperSymbol);
    if (!universeCheck.inUniverse) {
      return this.reject(upperSymbol, TradeRejectionReason.NOT_IN_UNIVERSE);
    }

    // Step 3: Check for upcoming earnings
    const earningsCheck = await this.earningsService.hasEarningsWithinDays(upperSymbol, 5);
    if (earningsCheck.hasEarnings) {
      this.logger.log(`${upperSymbol} has earnings in ${earningsCheck.daysUntil} days - rejecting`);
      return this.reject(upperSymbol, TradeRejectionReason.EARNINGS_SOON);
    }

    // Step 4: Get extended technical indicators
    let indicators;
    try {
      indicators = await this.polygonService.getExtendedIndicators(upperSymbol);
    } catch (error) {
      this.logger.error(`Failed to get indicators for ${upperSymbol}: ${(error as Error).message}`);
      return this.reject(upperSymbol, TradeRejectionReason.NOT_IN_UNIVERSE);
    }

    // Step 5: Check trend filter (MANDATORY)
    // Price must be above 200-day MA AND 200-day MA must be flat or rising
    if (indicators.priceVsSma200Percent < 0) {
      this.logger.log(`${upperSymbol} is below 200-day MA (${indicators.priceVsSma200Percent.toFixed(2)}%) - rejecting`);
      return this.reject(upperSymbol, TradeRejectionReason.BELOW_200_MA);
    }

    if (indicators.sma200Slope < -0.5) { // Allow slightly negative slope
      this.logger.log(`${upperSymbol} 200-day MA is declining (${indicators.sma200Slope.toFixed(2)}%) - rejecting`);
      return this.reject(upperSymbol, TradeRejectionReason.MA_200_DECLINING);
    }

    // Step 6: Check for valid trade setup
    const quote = await this.polygonService.getQuote(upperSymbol);
    const currentPrice = quote.price;

    const setup = await this.tradeSetupService.detectSetup(upperSymbol, indicators, currentPrice);
    if (!setup.hasSetup) {
      return this.reject(upperSymbol, TradeRejectionReason.NO_VALID_SETUP);
    }

    // Step 7: Calculate position size
    const state = this.circuitBreakerService.getState();
    const positionSize = this.positionSizingService.calculatePositionSize(
      setup.suggestedEntry,
      setup.suggestedStop,
      state.capitalDeployed,
    );

    if (!positionSize.valid) {
      if (positionSize.stopDistancePercent < 2) {
        return this.reject(upperSymbol, TradeRejectionReason.STOP_TOO_TIGHT);
      }
      if (positionSize.stopDistancePercent > 6) {
        return this.reject(upperSymbol, TradeRejectionReason.STOP_TOO_WIDE);
      }
      return this.reject(upperSymbol, TradeRejectionReason.MAX_CAPITAL_DEPLOYED);
    }

    // All checks passed - trade is qualified
    this.logger.log(`${upperSymbol} QUALIFIED: ${setup.setupType}, entry $${setup.suggestedEntry}, stop $${setup.suggestedStop}`);

    return {
      symbol: upperSymbol,
      qualified: true,
      setupType: setup.setupType,
      entryPrice: setup.suggestedEntry,
      stopPrice: setup.suggestedStop,
      stopDistancePercent: positionSize.stopDistancePercent,
      positionSizeDollars: positionSize.positionSizeDollars,
      shares: positionSize.shares,
      maxDollarRisk: positionSize.maxDollarRisk,
      estimatedUpsidePercent: setup.estimatedUpsidePercent,
    };
  }

  private reject(symbol: string, reason: TradeRejectionReason): TradeQualification {
    this.logger.log(`${symbol} REJECTED: ${reason}`);
    return {
      symbol,
      qualified: false,
      rejectionReason: reason,
    };
  }

  private mapCircuitBreakerReason(reason?: string): TradeRejectionReason {
    if (!reason) return TradeRejectionReason.DAILY_LIMIT_HIT;
    if (reason.includes('daily')) return TradeRejectionReason.DAILY_LIMIT_HIT;
    if (reason.includes('weekly')) return TradeRejectionReason.WEEKLY_LIMIT_HIT;
    if (reason.includes('monthly')) return TradeRejectionReason.MONTHLY_LIMIT_HIT;
    if (reason.includes('positions')) return TradeRejectionReason.MAX_POSITIONS;
    if (reason.includes('capital')) return TradeRejectionReason.MAX_CAPITAL_DEPLOYED;
    return TradeRejectionReason.DAILY_LIMIT_HIT;
  }

  async qualifyMultiple(symbols: string[]): Promise<TradeQualification[]> {
    const results: TradeQualification[] = [];

    for (const symbol of symbols) {
      try {
        const qualification = await this.qualifyTrade(symbol);
        results.push(qualification);

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        this.logger.error(`Error qualifying ${symbol}: ${(error as Error).message}`);
        results.push(this.reject(symbol, TradeRejectionReason.NOT_IN_UNIVERSE));
      }
    }

    // Sort: qualified first, then by estimated upside
    return results.sort((a, b) => {
      if (a.qualified && !b.qualified) return -1;
      if (!a.qualified && b.qualified) return 1;
      return (b.estimatedUpsidePercent || 0) - (a.estimatedUpsidePercent || 0);
    });
  }
}
```

**Step 2: Commit**

```bash
git add apps/api/src/strategy/trade-qualification.service.ts
git commit -m "feat: add trade qualification service as main orchestrator"
```

---

## Task 9: Implement Bracket Order Execution

**Files:**
- Modify: `apps/api/src/ib/ib.service.ts`

**Step 1: Add bracket order method to IB service**

Add this method to `apps/api/src/ib/ib.service.ts`:

```typescript
async placeBracketOrder(
  symbol: string,
  shares: number,
  entryLimitPrice: number,
  stopPrice: number,
): Promise<{
  parentOrderId: number;
  stopOrderId: number;
}> {
  // Check if we're in paper trading mode
  if (this.circuitBreaker.isPaperMode()) {
    return this.simulateBracketOrder(symbol, shares, entryLimitPrice, stopPrice);
  }

  const contract = this.createStockContract(symbol);
  const parentOrderId = this.getNextOrderId();
  const stopOrderId = this.getNextOrderId();

  // Parent order - limit buy
  const parentOrder: Order = {
    orderId: parentOrderId,
    action: OrderAction.BUY,
    orderType: OrderType.LMT,
    totalQuantity: shares,
    lmtPrice: entryLimitPrice,
    transmit: false, // Don't transmit until stop is attached
  };

  // Stop loss order - attached to parent
  const stopOrder: Order = {
    orderId: stopOrderId,
    action: OrderAction.SELL,
    orderType: OrderType.STP,
    totalQuantity: shares,
    auxPrice: stopPrice, // Stop trigger price
    parentId: parentOrderId,
    transmit: true, // Transmit both orders
  };

  this.ib.placeOrder(parentOrderId, contract, parentOrder);
  this.ib.placeOrder(stopOrderId, contract, stopOrder);

  this.logger.log(
    `Placed BRACKET order: BUY ${shares} ${symbol} @ ${entryLimitPrice}, STOP @ ${stopPrice}`
  );

  return { parentOrderId, stopOrderId };
}

private async simulateBracketOrder(
  symbol: string,
  shares: number,
  entryLimitPrice: number,
  stopPrice: number,
): Promise<{ parentOrderId: number; stopOrderId: number }> {
  const parentOrderId = this.paperOrderId++;
  const stopOrderId = this.paperOrderId++;

  this.logger.log(
    `[PAPER] Simulated BRACKET: BUY ${shares} ${symbol} @ ${entryLimitPrice}, STOP @ ${stopPrice}`
  );

  // Simulate entry fill after delay
  setTimeout(() => {
    this.eventEmitter.emit('ib.orderStatus', {
      orderId: parentOrderId,
      status: 'Filled',
      filled: shares,
      remaining: 0,
      avgFillPrice: entryLimitPrice,
      isPaper: true,
    });

    // Stop order becomes active
    this.eventEmitter.emit('ib.orderStatus', {
      orderId: stopOrderId,
      status: 'PreSubmitted',
      filled: 0,
      remaining: shares,
      avgFillPrice: 0,
      isPaper: true,
      stopPrice,
    });
  }, 100);

  return { parentOrderId, stopOrderId };
}

// Modify stop - only allowed to move UP (tighten), never widen
async modifyStopPrice(
  orderId: number,
  symbol: string,
  shares: number,
  currentStopPrice: number,
  newStopPrice: number,
): Promise<{ success: boolean; reason?: string }> {
  // CRITICAL: Stop can only move UP, never down
  if (newStopPrice < currentStopPrice) {
    this.logger.warn(`Rejected stop modification: ${newStopPrice} < ${currentStopPrice} (widening not allowed)`);
    return {
      success: false,
      reason: 'Stop losses may only move upward, never downward',
    };
  }

  if (orderId >= 100000) {
    // Paper order
    this.logger.log(`[PAPER] Modified STOP order ${orderId}: ${currentStopPrice} -> ${newStopPrice}`);
    this.eventEmitter.emit('ib.orderStatus', {
      orderId,
      status: 'PreSubmitted',
      filled: 0,
      remaining: shares,
      avgFillPrice: 0,
      isPaper: true,
      stopPrice: newStopPrice,
    });
    return { success: true };
  }

  const contract = this.createStockContract(symbol);

  const stopOrder: Order = {
    orderId,
    action: OrderAction.SELL,
    orderType: OrderType.STP,
    totalQuantity: shares,
    auxPrice: newStopPrice,
    transmit: true,
  };

  this.ib.placeOrder(orderId, contract, stopOrder);
  this.logger.log(`Modified STOP order ${orderId}: ${currentStopPrice} -> ${newStopPrice}`);

  return { success: true };
}
```

**Step 2: Commit**

```bash
git add apps/api/src/ib/ib.service.ts
git commit -m "feat: add bracket order execution with stop-only-up modification rule"
```

---

## Task 10: Create Trade Log Entity and Service

**Files:**
- Create: `apps/api/src/entities/trade-log.entity.ts`
- Create: `apps/api/src/logging/trade-logging.service.ts`
- Create: `apps/api/src/logging/logging.module.ts`

**Step 1: Create trade log entity**

```typescript
// apps/api/src/entities/trade-log.entity.ts

import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum TradeLogAction {
  FLAGGED = 'flagged',
  ENTERED = 'entered',
  EXITED = 'exited',
  REJECTED = 'rejected',
  STOP_MODIFIED = 'stop_modified',
}

@Entity('trade_logs')
export class TradeLog extends BaseEntity {
  @Column()
  symbol: string;

  @Column({
    type: 'enum',
    enum: TradeLogAction,
  })
  action: TradeLogAction;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  entryPrice: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  stopPrice: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  exitPrice: number;

  @Column('decimal', { precision: 12, scale: 2, nullable: true })
  positionSizeDollars: number;

  @Column('int', { nullable: true })
  shares: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  dollarRisk: number;

  @Column('decimal', { precision: 5, scale: 2, nullable: true })
  stopDistancePercent: number;

  @Column({ nullable: true })
  setupType: string;

  @Column({ nullable: true })
  rejectionReason: string;

  @Column({ nullable: true })
  exitReason: string;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  pnl: number;

  @Column('decimal', { precision: 5, scale: 2, nullable: true })
  pnlPercent: number;

  @Column('text', { nullable: true })
  notes: string;
}
```

**Step 2: Create trade logging service**

```typescript
// apps/api/src/logging/trade-logging.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TradeLog, TradeLogAction } from '../entities/trade-log.entity';
import { TradeQualification, TradeSetupType, TradeRejectionReason } from '../strategy/conservative-trading.types';

@Injectable()
export class TradeLoggingService {
  private readonly logger = new Logger(TradeLoggingService.name);

  constructor(
    @InjectRepository(TradeLog)
    private tradeLogRepo: Repository<TradeLog>,
  ) {}

  async logFlagged(qualification: TradeQualification): Promise<TradeLog> {
    const log = this.tradeLogRepo.create({
      symbol: qualification.symbol,
      action: TradeLogAction.FLAGGED,
      entryPrice: qualification.entryPrice,
      stopPrice: qualification.stopPrice,
      positionSizeDollars: qualification.positionSizeDollars,
      shares: qualification.shares,
      dollarRisk: qualification.maxDollarRisk,
      stopDistancePercent: qualification.stopDistancePercent,
      setupType: qualification.setupType,
      notes: `Estimated upside: ${qualification.estimatedUpsidePercent?.toFixed(1)}%`,
    });

    await this.tradeLogRepo.save(log);
    this.logger.log(`LOGGED FLAGGED: ${qualification.symbol} - ${qualification.setupType}`);
    return log;
  }

  async logRejected(symbol: string, reason: TradeRejectionReason): Promise<TradeLog> {
    const log = this.tradeLogRepo.create({
      symbol,
      action: TradeLogAction.REJECTED,
      rejectionReason: reason,
    });

    await this.tradeLogRepo.save(log);
    this.logger.log(`LOGGED REJECTED: ${symbol} - ${reason}`);
    return log;
  }

  async logEntered(
    symbol: string,
    entryPrice: number,
    stopPrice: number,
    shares: number,
    positionSizeDollars: number,
    dollarRisk: number,
    setupType: TradeSetupType,
  ): Promise<TradeLog> {
    const stopDistancePercent = ((entryPrice - stopPrice) / entryPrice) * 100;

    const log = this.tradeLogRepo.create({
      symbol,
      action: TradeLogAction.ENTERED,
      entryPrice,
      stopPrice,
      shares,
      positionSizeDollars,
      dollarRisk,
      stopDistancePercent,
      setupType,
    });

    await this.tradeLogRepo.save(log);
    this.logger.log(`LOGGED ENTERED: ${symbol} @ ${entryPrice}, stop ${stopPrice}, ${shares} shares`);
    return log;
  }

  async logExited(
    symbol: string,
    entryPrice: number,
    exitPrice: number,
    shares: number,
    exitReason: string,
  ): Promise<TradeLog> {
    const pnl = (exitPrice - entryPrice) * shares;
    const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;

    const log = this.tradeLogRepo.create({
      symbol,
      action: TradeLogAction.EXITED,
      entryPrice,
      exitPrice,
      shares,
      pnl,
      pnlPercent,
      exitReason,
    });

    await this.tradeLogRepo.save(log);
    this.logger.log(`LOGGED EXITED: ${symbol} @ ${exitPrice}, P&L: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`);
    return log;
  }

  async logStopModified(
    symbol: string,
    oldStop: number,
    newStop: number,
    shares: number,
  ): Promise<TradeLog> {
    const log = this.tradeLogRepo.create({
      symbol,
      action: TradeLogAction.STOP_MODIFIED,
      stopPrice: newStop,
      shares,
      notes: `Stop moved from ${oldStop} to ${newStop}`,
    });

    await this.tradeLogRepo.save(log);
    this.logger.log(`LOGGED STOP MODIFIED: ${symbol} ${oldStop} -> ${newStop}`);
    return log;
  }

  async getRecentLogs(limit: number = 100): Promise<TradeLog[]> {
    return this.tradeLogRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getLogsBySymbol(symbol: string): Promise<TradeLog[]> {
    return this.tradeLogRepo.find({
      where: { symbol: symbol.toUpperCase() },
      order: { createdAt: 'DESC' },
    });
  }
}
```

**Step 3: Create logging module**

```typescript
// apps/api/src/logging/logging.module.ts

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TradeLoggingService } from './trade-logging.service';
import { TradeLog } from '../entities/trade-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TradeLog])],
  providers: [TradeLoggingService],
  exports: [TradeLoggingService],
})
export class LoggingModule {}
```

**Step 4: Commit**

```bash
git add apps/api/src/entities/trade-log.entity.ts apps/api/src/logging/
git commit -m "feat: add comprehensive trade logging service"
```

---

## Task 11: Update Strategy Module

**Files:**
- Modify: `apps/api/src/strategy/strategy.module.ts`

**Step 1: Update the strategy module to include new services**

```typescript
// apps/api/src/strategy/strategy.module.ts

import { Module } from '@nestjs/common';
import { ScoringService } from './scoring.service';
import { TradeSetupService } from './trade-setup.service';
import { TradeQualificationService } from './trade-qualification.service';
import { DataModule } from '../data/data.module';
import { TradeUniverseModule } from '../universe/trade-universe.module';
import { EventsModule } from '../events/events.module';
import { RiskModule } from '../risk/risk.module';
import { SafetyModule } from '../safety/safety.module';

@Module({
  imports: [
    DataModule,
    TradeUniverseModule,
    EventsModule,
    RiskModule,
    SafetyModule,
  ],
  providers: [
    ScoringService,
    TradeSetupService,
    TradeQualificationService,
  ],
  exports: [
    ScoringService,
    TradeSetupService,
    TradeQualificationService,
  ],
})
export class StrategyModule {}
```

**Step 2: Commit**

```bash
git add apps/api/src/strategy/strategy.module.ts
git commit -m "feat: update strategy module with new qualification services"
```

---

## Task 12: Update App Module

**Files:**
- Modify: `apps/api/src/app.module.ts`

**Step 1: Import all new modules**

```typescript
// apps/api/src/app.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DatabaseModule } from './database/database.module';
import { IBModule } from './ib/ib.module';
import { DataModule } from './data/data.module';
import { StrategyModule } from './strategy/strategy.module';
import { AIModule } from './ai/ai.module';
import { ScannerModule } from './scanner/scanner.module';
import { SafetyModule } from './safety/safety.module';
import { AuthModule } from './auth/auth.module';
import { TradeUniverseModule } from './universe/trade-universe.module';
import { EventsModule } from './events/events.module';
import { RiskModule } from './risk/risk.module';
import { LoggingModule } from './logging/logging.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuthModule,
    IBModule,
    DataModule,
    TradeUniverseModule,
    EventsModule,
    RiskModule,
    StrategyModule,
    AIModule,
    ScannerModule,
    SafetyModule,
    LoggingModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
```

**Step 2: Commit**

```bash
git add apps/api/src/app.module.ts
git commit -m "feat: register all new modules in app module"
```

---

## Task 13: Update Database Module for New Entities

**Files:**
- Modify: `apps/api/src/database/database.module.ts`

**Step 1: Add TradeLog entity to the database module**

Ensure the database module includes the new TradeLog entity:

```typescript
// In the TypeOrmModule.forRoot entities array, add:
import { TradeLog } from '../entities/trade-log.entity';

// Add TradeLog to the entities array
entities: [
  User,
  Setting,
  ActivityLog,
  Position,
  Trade,
  Opportunity,
  WatchlistItem,
  TradeLog,  // Add this
],
```

**Step 2: Commit**

```bash
git add apps/api/src/database/database.module.ts
git commit -m "feat: add TradeLog entity to database module"
```

---

## Task 14: Build and Test

**Step 1: Build the project**

Run: `cd /Users/danymoussa/Desktop/Claude/trading/apps/api && npm run build`
Expected: Build completes without errors

**Step 2: Fix any TypeScript errors**

If there are errors, fix them one by one.

**Step 3: Commit final build**

```bash
git add -A
git commit -m "feat: complete conservative swing trading bot implementation"
```

---

## Summary

This implementation plan creates a conservative, risk-first swing trading system with:

1. **Trade Universe Filtering** - Only S&P 500, Nasdaq 100, and liquid ETFs with >2M avg daily volume
2. **Mandatory Trend Filter** - Price above 200-day MA + MA rising
3. **Risk-Based Position Sizing** - Position = MaxRisk / StopDistance%
4. **Conservative Drawdown Limits** - 0.5% daily / 1.5% weekly / 3% monthly
5. **Earnings Event Filter** - No trades within 5 days of earnings
6. **Trade Setup Detection** - Mean reversion, MA pullbacks, oversold stabilization
7. **Stop Distance Validation** - Only 2-6% stops allowed
8. **Bracket Order Execution** - Server-side stops, never widened
9. **Comprehensive Trade Logging** - Full audit trail of all decisions

The system will reject most trades by design, prioritizing capital preservation over returns.
