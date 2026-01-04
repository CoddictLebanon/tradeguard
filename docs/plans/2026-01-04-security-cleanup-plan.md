# Security Hardening & Code Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the TradeGuard application against security vulnerabilities and remove dead/unused code.

**Architecture:** Add security middleware (Helmet, rate limiting) to NestJS API, add API key authentication to Python IB proxy, remove unused services/modules, and fix type safety issues.

**Tech Stack:** NestJS, FastAPI (Python), TypeScript, class-validator, Helmet, express-rate-limit

---

## Phase 1: Security Hardening (HIGH PRIORITY)

### Task 1: Add Helmet Security Headers

**Files:**
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/package.json`

**Step 1: Install Helmet package**

Run:
```bash
cd apps/api && npm install helmet
```
Expected: Package added to package.json

**Step 2: Add Helmet middleware to main.ts**

Modify `apps/api/src/main.ts` - add import and use:

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Security headers
  app.use(helmet());

  // Allow CORS from multiple origins for remote access
  const allowedOrigins = [
    'http://localhost:666',
    process.env.FRONTEND_URL,
  ].filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      const localNetworkPattern = /^http:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;
      if (allowedOrigins.includes(origin) || localNetworkPattern.test(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }));

  const port = process.env.PORT || 667;
  await app.listen(port);
  console.log(`TradeGuard API running on port ${port}`);
}

bootstrap();
```

**Step 3: Verify API still starts**

Run:
```bash
cd apps/api && npm run build
```
Expected: Build succeeds with no errors

**Step 4: Commit**

```bash
git add apps/api/src/main.ts apps/api/package.json apps/api/package-lock.json
git commit -m "feat(security): add Helmet security headers middleware"
```

---

### Task 2: Add Rate Limiting to Auth Endpoints

**Files:**
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/package.json`

**Step 1: Install rate limiting packages**

Run:
```bash
cd apps/api && npm install @nestjs/throttler
```
Expected: Package added to package.json

**Step 2: Add ThrottlerModule to app.module.ts**

Modify `apps/api/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './database/database.module';
import { IBModule } from './ib/ib.module';
import { DataModule } from './data/data.module';
import { StrategyModule } from './strategy/strategy.module';
import { ScannerModule } from './scanner/scanner.module';
import { SafetyModule } from './safety/safety.module';
import { AuthModule } from './auth/auth.module';
import { TradeUniverseModule } from './universe/trade-universe.module';
import { EventsModule } from './events/events.module';
import { RiskModule } from './risk/risk.module';
import { PositionsModule } from './positions/positions.module';
import { WatchlistModule } from './watchlist/watchlist.module';
import { ActivityModule } from './activity/activity.module';
import { SimulationModule } from './simulation/simulation.module';
import { TelegramModule } from './telegram/telegram.module';
import { CronLogModule } from './cron-log/cron-log.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    ThrottlerModule.forRoot([{
      ttl: 60000, // 1 minute
      limit: 10,  // 10 requests per minute for auth endpoints
    }]),
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
    ScannerModule,
    SafetyModule,
    PositionsModule,
    WatchlistModule,
    ActivityModule,
    SimulationModule,
    TelegramModule,
    CronLogModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
```

**Step 3: Add throttler guard to auth controller**

Modify `apps/api/src/auth/auth.controller.ts` - add throttler to login:

```typescript
import {
  Controller,
  Post,
  Get,
  Body,
  Request,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthService, AuthResponse } from './auth.service';
import { Public } from './public.decorator';
import { Roles } from './roles.decorator';
import { UserRole } from '../entities/user.entity';
import { IsEmail, IsString, MinLength, IsOptional, IsEnum } from 'class-validator';

// ... existing DTOs stay the same ...

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ... existing endpoints ...

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('login')
  async login(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.authService.login(dto.email, dto.password);
  }

  // ... rest stays the same ...
}
```

**Step 4: Verify build succeeds**

Run:
```bash
cd apps/api && npm run build
```
Expected: Build succeeds

**Step 5: Commit**

```bash
git add apps/api/src/app.module.ts apps/api/src/auth/auth.controller.ts apps/api/package.json apps/api/package-lock.json
git commit -m "feat(security): add rate limiting to auth endpoints"
```

---

### Task 3: Add API Key Authentication to IB Proxy

**Files:**
- Modify: `ib-proxy/proxy.py`
- Modify: `.env.example` (create if not exists)

**Step 1: Add API key validation to proxy.py**

Modify `ib-proxy/proxy.py` - add API key middleware:

```python
#!/usr/bin/env python3
"""
IB Proxy - A reliable async service that bridges the trading app with Interactive Brokers.
Uses FastAPI for async HTTP handling and ThreadPoolExecutor for IB operations with timeouts.
Includes active heartbeat monitoring to detect stale connections.
"""

import os
import asyncio
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Depends, Security
from fastapi.security import APIKeyHeader
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# Suppress ib_insync logging noise
import logging
logging.getLogger('ib_insync').setLevel(logging.WARNING)

from ib_insync import IB, Stock, MarketOrder, StopOrder

# === Configuration ===
IB_TIMEOUT = 5  # seconds - max time to wait for any IB operation
IB_PORT = 4002
PROXY_PORT = int(os.environ.get('IB_PROXY_PORT', 6680))
HEARTBEAT_INTERVAL = 5  # seconds between heartbeat checks
HEARTBEAT_MAX_FAILURES = 3  # consecutive failures before marking disconnected

# API Key for authentication (required in production)
API_KEY = os.environ.get('IB_PROXY_API_KEY', '')
API_KEY_HEADER = APIKeyHeader(name='X-API-Key', auto_error=False)

async def verify_api_key(api_key: str = Security(API_KEY_HEADER)):
    """Verify API key if configured"""
    if not API_KEY:
        # No API key configured - allow (development mode)
        return True
    if api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
    return True

# ... rest of the file stays the same until the endpoints ...
```

**Step 2: Add API key dependency to all order endpoints**

In `ib-proxy/proxy.py`, modify the order endpoints to require auth:

```python
@app.post("/order/buy")
async def place_buy_order(req: BuyOrderRequest, _: bool = Depends(verify_api_key)):
    """Place a market buy order"""
    return await run_with_timeout(_ib_place_buy_order, req.symbol, req.quantity)

@app.post("/order/sell")
async def place_sell_order(req: SellOrderRequest, _: bool = Depends(verify_api_key)):
    """Place a market sell order"""
    return await run_with_timeout(_ib_place_sell_order, req.symbol, req.quantity)

@app.post("/order/stop")
async def place_stop_order(req: StopOrderRequest, _: bool = Depends(verify_api_key)):
    """Place a stop loss order"""
    return await run_with_timeout(_ib_place_stop_order, req.symbol, req.quantity, req.stopPrice)

@app.put("/order/stop/{order_id}")
async def modify_stop_order(order_id: int, req: StopOrderRequest, _: bool = Depends(verify_api_key)):
    """Modify an existing stop order"""
    return await run_with_timeout(_ib_modify_stop_order, order_id, req.symbol, req.quantity, req.stopPrice)

@app.delete("/order/cancel/{order_id}")
async def cancel_order(order_id: int, _: bool = Depends(verify_api_key)):
    """Cancel an order"""
    return await run_with_timeout(_ib_cancel_order, order_id)

@app.post("/connect")
async def connect(req: ConnectRequest, _: bool = Depends(verify_api_key)):
    """Connect to IB Gateway"""
    # ... existing implementation ...

@app.post("/disconnect")
async def disconnect(_: bool = Depends(verify_api_key)):
    """Disconnect from IB Gateway"""
    _ib_disconnect()
    return {'success': True}
```

**Step 3: Bind to localhost only**

In `ib-proxy/proxy.py`, change the last line:

```python
if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=PROXY_PORT, log_level='warning')
```

**Step 4: Update NestJS IB service to send API key**

Modify `apps/api/src/ib/ib.service.ts` - add API key header to fetch calls:

Add near the top of the class:
```typescript
private readonly proxyApiKey: string;

constructor(
  private readonly configService: ConfigService,
  // ... other injections
) {
  this.proxyApiKey = this.configService.get<string>('IB_PROXY_API_KEY', '');
  // ... rest of constructor
}
```

Update fetch calls to include the header (example pattern):
```typescript
private async proxyFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(this.proxyApiKey && { 'X-API-Key': this.proxyApiKey }),
  };

  return fetch(`http://localhost:6680${endpoint}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });
}
```

**Step 5: Create .env.example if not exists**

Create `/.env.example`:
```
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tradeguard

# Authentication
JWT_SECRET=change-this-to-a-secure-random-string
ADMIN_PASSWORD=change-this-secure-password

# IB Proxy Security
IB_PROXY_API_KEY=generate-a-random-api-key-here

# Market Data APIs
POLYGON_API_KEY=your_polygon_api_key
FINNHUB_API_KEY=your_finnhub_api_key

# Frontend
FRONTEND_URL=http://localhost:666
```

**Step 6: Commit**

```bash
git add ib-proxy/proxy.py apps/api/src/ib/ib.service.ts .env.example
git commit -m "feat(security): add API key authentication to IB proxy"
```

---

### Task 4: Fix Hardcoded Portfolio Value

**Files:**
- Modify: `apps/api/src/ib/ib.controller.ts`

**Step 1: Fetch real portfolio value for order validation**

Modify `apps/api/src/ib/ib.controller.ts`:

```typescript
@Post('order/buy')
@Roles(UserRole.ADMIN, UserRole.TRADER)
async placeBuyOrder(@Body() dto: PlaceBuyOrderDto) {
  this.requireConnection();

  // Fetch actual portfolio value from IB
  let portfolioValue = 100000; // Conservative fallback
  try {
    const account = await this.ibService.getAccountSummary();
    if (account?.netLiquidation) {
      portfolioValue = account.netLiquidation;
    }
  } catch (error) {
    // Use fallback if account fetch fails
  }

  // Validate order before placement
  const price = dto.limitPrice || 100;
  const validation = await this.orderValidation.validateBuyOrder(
    dto.symbol.toUpperCase(),
    dto.quantity,
    price,
    portfolioValue,
  );

  if (!validation.valid) {
    throw new HttpException(
      { message: 'Order validation failed', errors: validation.errors },
      HttpStatus.BAD_REQUEST,
    );
  }

  const quantity = validation.adjustedQuantity || dto.quantity;

  const buyOrderId = await this.ibService.placeBuyOrder(
    dto.symbol.toUpperCase(),
    quantity,
    dto.limitPrice,
  );

  const stopOrderId = await this.ibService.placeTrailingStopOrder(
    dto.symbol.toUpperCase(),
    quantity,
    dto.trailPercent,
  );

  return {
    buyOrderId,
    stopOrderId,
    quantity,
    warnings: validation.warnings,
    message: `Buy order placed with trailing stop at ${dto.trailPercent}%`,
  };
}

@Post('order/sell')
@Roles(UserRole.ADMIN, UserRole.TRADER)
async placeSellOrder(@Body() dto: PlaceSellOrderDto) {
  this.requireConnection();

  // Fetch actual portfolio value from IB
  let portfolioValue = 100000;
  try {
    const account = await this.ibService.getAccountSummary();
    if (account?.netLiquidation) {
      portfolioValue = account.netLiquidation;
    }
  } catch (error) {
    // Use fallback
  }

  const price = dto.limitPrice || 100;
  const validation = await this.orderValidation.validateSellOrder(
    dto.symbol.toUpperCase(),
    dto.quantity,
    price,
    portfolioValue,
  );

  if (!validation.valid) {
    throw new HttpException(
      { message: 'Order validation failed', errors: validation.errors },
      HttpStatus.BAD_REQUEST,
    );
  }

  const orderId = await this.ibService.placeSellOrder(
    dto.symbol.toUpperCase(),
    dto.quantity,
    dto.limitPrice,
  );

  return { orderId, warnings: validation.warnings };
}
```

**Step 2: Verify build**

Run:
```bash
cd apps/api && npm run build
```
Expected: Build succeeds

**Step 3: Commit**

```bash
git add apps/api/src/ib/ib.controller.ts
git commit -m "fix(security): use real portfolio value for order validation"
```

---

### Task 5: Remove Default Password Fallback

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts`

**Step 1: Make ADMIN_PASSWORD required**

Modify `apps/api/src/auth/auth.service.ts`:

```typescript
async createInitialAdmin(): Promise<void> {
  const adminCount = await this.userRepo.count({ where: { role: UserRole.ADMIN } });
  if (adminCount === 0) {
    const defaultPassword = process.env.ADMIN_PASSWORD;
    if (!defaultPassword) {
      this.logger.error('ADMIN_PASSWORD environment variable is required for initial admin setup');
      throw new Error('ADMIN_PASSWORD environment variable must be set');
    }
    if (defaultPassword.length < 12) {
      this.logger.warn('ADMIN_PASSWORD should be at least 12 characters for security');
    }
    await this.register('admin@tradeguard.local', defaultPassword, 'Admin', UserRole.ADMIN);
    this.logger.warn('Created default admin user - CHANGE THE PASSWORD IMMEDIATELY');
  }
}
```

**Step 2: Verify build**

Run:
```bash
cd apps/api && npm run build
```
Expected: Build succeeds

**Step 3: Commit**

```bash
git add apps/api/src/auth/auth.service.ts
git commit -m "fix(security): require ADMIN_PASSWORD env var, remove insecure fallback"
```

---

## Phase 2: Dead Code Removal (MEDIUM PRIORITY)

### Task 6: Remove Unused LoggingModule and TradeLoggingService

**Files:**
- Delete: `apps/api/src/logging/trade-logging.service.ts`
- Delete: `apps/api/src/logging/logging.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Delete: `apps/api/src/entities/trade-log.entity.ts`
- Modify: `apps/api/src/database/database.module.ts`

**Step 1: Remove LoggingModule from AppModule imports**

Modify `apps/api/src/app.module.ts` - remove the import and from imports array:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './database/database.module';
import { IBModule } from './ib/ib.module';
import { DataModule } from './data/data.module';
import { StrategyModule } from './strategy/strategy.module';
import { ScannerModule } from './scanner/scanner.module';
import { SafetyModule } from './safety/safety.module';
import { AuthModule } from './auth/auth.module';
import { TradeUniverseModule } from './universe/trade-universe.module';
import { EventsModule } from './events/events.module';
import { RiskModule } from './risk/risk.module';
import { PositionsModule } from './positions/positions.module';
import { WatchlistModule } from './watchlist/watchlist.module';
import { ActivityModule } from './activity/activity.module';
import { SimulationModule } from './simulation/simulation.module';
import { TelegramModule } from './telegram/telegram.module';
import { CronLogModule } from './cron-log/cron-log.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 10,
    }]),
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
    ScannerModule,
    SafetyModule,
    PositionsModule,
    WatchlistModule,
    ActivityModule,
    SimulationModule,
    TelegramModule,
    CronLogModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
```

**Step 2: Remove TradeLog from database.module.ts**

Modify `apps/api/src/database/database.module.ts` - remove TradeLog import.

**Step 3: Delete the files**

Run:
```bash
rm apps/api/src/logging/trade-logging.service.ts
rm apps/api/src/logging/logging.module.ts
rmdir apps/api/src/logging
rm apps/api/src/entities/trade-log.entity.ts
```

**Step 4: Verify build**

Run:
```bash
cd apps/api && npm run build
```
Expected: Build succeeds (no references to deleted files)

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove unused LoggingModule and TradeLoggingService"
```

---

### Task 7: Consolidate FinnhubService (Remove Duplicate)

**Files:**
- Modify: `apps/api/src/events/earnings-calendar.service.ts`
- Modify: `apps/api/src/events/events.module.ts`

**Step 1: Update EarningsCalendarService to use FinnhubService**

Modify `apps/api/src/events/earnings-calendar.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { FinnhubService } from '../data/finnhub.service';

interface EarningsEvent {
  symbol: string;
  date: Date;
  timing: 'BMO' | 'AMC' | 'UNKNOWN';
}

@Injectable()
export class EarningsCalendarService {
  private readonly logger = new Logger(EarningsCalendarService.name);

  constructor(private readonly finnhubService: FinnhubService) {}

  async hasEarningsWithinDays(symbol: string, days: number = 5): Promise<{
    hasEarnings: boolean;
    nextEarningsDate?: Date;
    daysUntil?: number;
  }> {
    try {
      const earnings = await this.finnhubService.getEarningsCalendar(symbol);

      if (!earnings || earnings.length === 0) {
        return { hasEarnings: false };
      }

      const now = new Date();
      now.setHours(0, 0, 0, 0);

      for (const event of earnings) {
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
      // Fail safe - block trades when uncertain
      return { hasEarnings: true };
    }
  }
}
```

**Step 2: Add getEarningsCalendar method to FinnhubService**

Modify `apps/api/src/data/finnhub.service.ts` - add the method:

```typescript
async getEarningsCalendar(symbol: string): Promise<Array<{ date: string }>> {
  if (!this.apiKey) {
    this.logger.warn('FINNHUB_API_KEY not configured');
    return [];
  }

  const data = await this.fetch<{ earningsCalendar?: Array<{ date: string }> }>(
    `/calendar/earnings?symbol=${symbol}`
  );

  return data?.earningsCalendar || [];
}
```

**Step 3: Update EventsModule to import DataModule**

Modify `apps/api/src/events/events.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { DataModule } from '../data/data.module';
import { EarningsCalendarService } from './earnings-calendar.service';

@Module({
  imports: [DataModule],
  providers: [EarningsCalendarService],
  exports: [EarningsCalendarService],
})
export class EventsModule {}
```

**Step 4: Verify build**

Run:
```bash
cd apps/api && npm run build
```
Expected: Build succeeds

**Step 5: Commit**

```bash
git add apps/api/src/events/earnings-calendar.service.ts apps/api/src/events/events.module.ts apps/api/src/data/finnhub.service.ts
git commit -m "refactor: consolidate Finnhub API calls into FinnhubService"
```

---

## Phase 3: Code Quality (LOW PRIORITY)

### Task 8: Add Proper DTOs for Remaining Endpoints

**Files:**
- Create: `apps/api/src/safety/dto/safety.dto.ts`
- Create: `apps/api/src/watchlist/dto/watchlist.dto.ts`
- Create: `apps/api/src/telegram/dto/telegram.dto.ts`
- Modify: `apps/api/src/safety/safety.controller.ts`
- Modify: `apps/api/src/watchlist/watchlist.controller.ts`
- Modify: `apps/api/src/telegram/telegram.controller.ts`

**Step 1: Create safety DTOs**

Create `apps/api/src/safety/dto/safety.dto.ts`:

```typescript
import { IsNumber, IsOptional, IsString, Min, Max } from 'class-validator';

export class UpdateLimitsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  maxDailyLoss?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  maxWeeklyLoss?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  maxMonthlyLoss?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(20)
  maxOpenPositions?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  maxConsecutiveLosses?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  maxCapitalDeployed?: number;
}

export class PauseResumeDto {
  @IsString()
  reason: string;
}

export class UpdateSimulationConfigDto {
  @IsOptional()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(365)
  maxDays?: number;
}
```

**Step 2: Create watchlist DTOs**

Create `apps/api/src/watchlist/dto/watchlist.dto.ts`:

```typescript
import { IsString, IsOptional, Matches } from 'class-validator';

export class AddToWatchlistDto {
  @IsString()
  @Matches(/^[A-Z]{1,5}$/, { message: 'Symbol must be 1-5 uppercase letters' })
  symbol: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateNotesDto {
  @IsString()
  notes: string;
}
```

**Step 3: Create telegram DTOs**

Create `apps/api/src/telegram/dto/telegram.dto.ts`:

```typescript
import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class UpdateTelegramConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  botToken?: string;

  @IsOptional()
  @IsString()
  chatId?: string;

  @IsOptional()
  @IsBoolean()
  notifyOpened?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyStopRaised?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyClosed?: boolean;
}
```

**Step 4: Update controllers to use DTOs**

Update each controller to import and use the new DTOs.

**Step 5: Verify build**

Run:
```bash
cd apps/api && npm run build
```
Expected: Build succeeds

**Step 6: Commit**

```bash
git add apps/api/src/safety/dto apps/api/src/watchlist/dto apps/api/src/telegram/dto apps/api/src/safety/safety.controller.ts apps/api/src/watchlist/watchlist.controller.ts apps/api/src/telegram/telegram.controller.ts
git commit -m "refactor: add proper DTOs for safety, watchlist, and telegram endpoints"
```

---

### Task 9: Replace console.log with NestJS Logger

**Files:**
- Modify: `apps/api/src/main.ts`

**Step 1: Use Logger in main.ts**

Modify `apps/api/src/main.ts`:

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Security headers
  app.use(helmet());

  // ... rest of the config ...

  const port = process.env.PORT || 667;
  await app.listen(port);
  logger.log(`TradeGuard API running on port ${port}`);
}

bootstrap();
```

**Step 2: Commit**

```bash
git add apps/api/src/main.ts
git commit -m "refactor: replace console.log with NestJS Logger"
```

---

### Task 10: Final Cleanup and Verification

**Step 1: Run full build**

```bash
cd apps/api && npm run build
```
Expected: Build succeeds with no errors or warnings

**Step 2: Run linter**

```bash
npm run lint
```
Expected: No linting errors

**Step 3: Test the API starts**

```bash
cd apps/api && npm run dev
```
Expected: API starts successfully

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup and verification"
```

---

## Summary

| Phase | Tasks | Priority |
|-------|-------|----------|
| Security | Tasks 1-5 | HIGH |
| Dead Code | Tasks 6-7 | MEDIUM |
| Code Quality | Tasks 8-10 | LOW |

**Total Tasks:** 10
**Estimated Time:** 1-2 hours

**Post-Implementation:**
- Update `.env` with `IB_PROXY_API_KEY`
- Ensure `ADMIN_PASSWORD` is set in production
- Test all endpoints still work
- Verify IB proxy authentication works
