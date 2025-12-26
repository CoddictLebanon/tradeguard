# TradeGuard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an AI-powered trading assistant that monitors stocks, analyzes opportunities, and executes trades via Interactive Brokers with manual approval.

**Architecture:** Next.js frontend dashboard + NestJS backend with modular services. Three AI agents (news, reasoning, risk) analyze opportunities. PostgreSQL stores positions, history, and settings. Real-time WebSocket updates.

**Tech Stack:** TypeScript, Next.js 14, NestJS 10, PostgreSQL, @stoqey/ib, Polygon.io, Claude API, Docker

---

## Phase 1: Project Setup

### Task 1.1: Initialize Monorepo Structure

**Files:**
- Create: `package.json`
- Create: `apps/api/package.json`
- Create: `apps/web/package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`

**Step 1: Create root package.json for monorepo**

```bash
cat > package.json << 'EOF'
{
  "name": "tradeguard",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev": "concurrently \"npm run dev:api\" \"npm run dev:web\"",
    "dev:api": "npm run dev -w apps/api",
    "dev:web": "npm run dev -w apps/web",
    "build": "npm run build -w apps/api && npm run build -w apps/web",
    "test": "npm run test -w apps/api",
    "lint": "eslint apps packages --ext .ts,.tsx"
  },
  "devDependencies": {
    "concurrently": "^8.2.2",
    "typescript": "^5.3.3"
  }
}
EOF
```

**Step 2: Create base TypeScript config**

```bash
cat > tsconfig.base.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
EOF
```

**Step 3: Create .gitignore**

```bash
cat > .gitignore << 'EOF'
# Dependencies
node_modules/

# Build outputs
dist/
.next/
build/

# Environment
.env
.env.local
.env.*.local

# IDE
.vscode/
.idea/

# OS
.DS_Store

# Logs
*.log
npm-debug.log*

# Test coverage
coverage/

# Database
*.sqlite
EOF
```

**Step 4: Create apps directory structure**

```bash
mkdir -p apps/api apps/web packages/shared
```

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: initialize monorepo structure"
```

---

### Task 1.2: Setup NestJS API Application

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/nest-cli.json`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`

**Step 1: Create API package.json**

```bash
cat > apps/api/package.json << 'EOF'
{
  "name": "@tradeguard/api",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main",
    "start:prod": "node dist/main",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:cov": "jest --coverage"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.0",
    "@nestjs/config": "^3.1.1",
    "@nestjs/core": "^10.3.0",
    "@nestjs/platform-express": "^10.3.0",
    "@nestjs/schedule": "^4.0.0",
    "@nestjs/typeorm": "^10.0.1",
    "@nestjs/websockets": "^10.3.0",
    "@nestjs/platform-socket.io": "^10.3.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.0",
    "pg": "^8.11.3",
    "reflect-metadata": "^0.2.1",
    "rxjs": "^7.8.1",
    "typeorm": "^0.3.19"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.3.0",
    "@nestjs/testing": "^10.3.0",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.11",
    "@types/node": "^20.10.6",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.1",
    "typescript": "^5.3.3"
  }
}
EOF
```

**Step 2: Create API tsconfig.json**

```bash
cat > apps/api/tsconfig.json << 'EOF'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "./dist",
    "rootDir": "./src",
    "baseUrl": "./",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
EOF
```

**Step 3: Create nest-cli.json**

```bash
cat > apps/api/nest-cli.json << 'EOF'
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
EOF
```

**Step 4: Create src directory and main.ts**

```bash
mkdir -p apps/api/src
cat > apps/api/src/main.ts << 'EOF'
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }));

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`TradeGuard API running on port ${port}`);
}

bootstrap();
EOF
```

**Step 5: Create app.module.ts**

```bash
cat > apps/api/src/app.module.ts << 'EOF'
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
EOF
```

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: setup NestJS API application"
```

---

### Task 1.3: Setup Next.js Frontend Application

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.js`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`

**Step 1: Create web package.json**

```bash
cat > apps/web/package.json << 'EOF'
{
  "name": "@tradeguard/web",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "^14.0.4",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "socket.io-client": "^4.6.1"
  },
  "devDependencies": {
    "@types/node": "^20.10.6",
    "@types/react": "^18.2.46",
    "@types/react-dom": "^18.2.18",
    "autoprefixer": "^10.4.16",
    "postcss": "^8.4.32",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.3.3"
  }
}
EOF
```

**Step 2: Create web tsconfig.json**

```bash
cat > apps/web/tsconfig.json << 'EOF'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "ES2022"],
    "jsx": "preserve",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    },
    "incremental": true
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
EOF
```

**Step 3: Create next.config.js**

```bash
cat > apps/web/next.config.js << 'EOF'
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
}

module.exports = nextConfig
EOF
```

**Step 4: Create app directory with layout and page**

```bash
mkdir -p apps/web/src/app
cat > apps/web/src/app/layout.tsx << 'EOF'
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TradeGuard',
  description: 'AI-Powered Trading Assistant',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-900 text-white">{children}</body>
    </html>
  );
}
EOF
```

```bash
cat > apps/web/src/app/page.tsx << 'EOF'
export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-3xl font-bold">TradeGuard</h1>
      <p className="mt-4 text-gray-400">AI-Powered Trading Assistant</p>
    </main>
  );
}
EOF
```

**Step 5: Create globals.css with Tailwind**

```bash
cat > apps/web/src/app/globals.css << 'EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;
EOF
```

**Step 6: Create Tailwind config**

```bash
cat > apps/web/tailwind.config.js << 'EOF'
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
EOF
```

```bash
cat > apps/web/postcss.config.js << 'EOF'
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
EOF
```

**Step 7: Commit**

```bash
git add -A
git commit -m "chore: setup Next.js frontend application"
```

---

### Task 1.4: Setup Environment Configuration

**Files:**
- Create: `.env.example`
- Create: `apps/api/.env.example`

**Step 1: Create root .env.example**

```bash
cat > .env.example << 'EOF'
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tradeguard

# Interactive Brokers
IB_HOST=127.0.0.1
IB_PORT=7497
IB_CLIENT_ID=1

# Data Providers
POLYGON_API_KEY=your_polygon_api_key
FINNHUB_API_KEY=your_finnhub_api_key

# AI
ANTHROPIC_API_KEY=your_anthropic_api_key

# App
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:3000

# Notifications (optional)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
EOF
```

**Step 2: Create API .env.example**

```bash
cp .env.example apps/api/.env.example
```

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: add environment configuration examples"
```

---

## Phase 2: Database Setup

### Task 2.1: Configure TypeORM and Create Base Entities

**Files:**
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/src/database/database.module.ts`
- Create: `apps/api/src/entities/base.entity.ts`

**Step 1: Create database module**

```bash
mkdir -p apps/api/src/database
cat > apps/api/src/database/database.module.ts << 'EOF'
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        entities: [__dirname + '/../**/*.entity{.ts,.js}'],
        synchronize: config.get<string>('NODE_ENV') === 'development',
        logging: config.get<string>('NODE_ENV') === 'development',
      }),
    }),
  ],
})
export class DatabaseModule {}
EOF
```

**Step 2: Create base entity**

```bash
mkdir -p apps/api/src/entities
cat > apps/api/src/entities/base.entity.ts << 'EOF'
import {
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
EOF
```

**Step 3: Update app.module.ts to include DatabaseModule**

```bash
cat > apps/api/src/app.module.ts << 'EOF'
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
EOF
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: configure TypeORM with PostgreSQL"
```

---

### Task 2.2: Create Core Entities

**Files:**
- Create: `apps/api/src/entities/watchlist.entity.ts`
- Create: `apps/api/src/entities/opportunity.entity.ts`
- Create: `apps/api/src/entities/position.entity.ts`
- Create: `apps/api/src/entities/trade.entity.ts`
- Create: `apps/api/src/entities/settings.entity.ts`

**Step 1: Create watchlist entity**

```bash
cat > apps/api/src/entities/watchlist.entity.ts << 'EOF'
import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('watchlist')
export class WatchlistItem extends BaseEntity {
  @Column({ unique: true })
  symbol: string;

  @Column({ nullable: true })
  notes: string;

  @Column({ default: true })
  active: boolean;

  @Column({ default: false })
  fromScreener: boolean;
}
EOF
```

**Step 2: Create opportunity entity**

```bash
cat > apps/api/src/entities/opportunity.entity.ts << 'EOF'
import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum OpportunityStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
}

@Entity('opportunities')
export class Opportunity extends BaseEntity {
  @Column()
  symbol: string;

  @Column('decimal', { precision: 5, scale: 2 })
  score: number;

  @Column('jsonb')
  factors: {
    volumeSurge: number;
    technicalBreakout: number;
    sectorMomentum: number;
    newsSentiment: number;
    volatilityFit: number;
  };

  @Column('decimal', { precision: 10, scale: 2 })
  currentPrice: number;

  @Column('text', { nullable: true })
  aiAnalysis: string;

  @Column('text', { nullable: true })
  bullCase: string;

  @Column('text', { nullable: true })
  bearCase: string;

  @Column('decimal', { precision: 5, scale: 2, nullable: true })
  aiConfidence: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  suggestedEntry: number;

  @Column('decimal', { precision: 5, scale: 2, nullable: true })
  suggestedTrailPercent: number;

  @Column({
    type: 'enum',
    enum: OpportunityStatus,
    default: OpportunityStatus.PENDING,
  })
  status: OpportunityStatus;

  @Column({ nullable: true })
  expiresAt: Date;
}
EOF
```

**Step 3: Create position entity**

```bash
cat > apps/api/src/entities/position.entity.ts << 'EOF'
import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum PositionStatus {
  OPEN = 'open',
  CLOSED = 'closed',
  PENDING = 'pending',
}

@Entity('positions')
export class Position extends BaseEntity {
  @Column()
  symbol: string;

  @Column('decimal', { precision: 10, scale: 2 })
  entryPrice: number;

  @Column('int')
  shares: number;

  @Column('decimal', { precision: 10, scale: 2 })
  stopPrice: number;

  @Column('decimal', { precision: 5, scale: 2 })
  trailPercent: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  currentPrice: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  highestPrice: number;

  @Column({
    type: 'enum',
    enum: PositionStatus,
    default: PositionStatus.PENDING,
  })
  status: PositionStatus;

  @Column({ nullable: true })
  ibOrderId: string;

  @Column({ nullable: true })
  ibStopOrderId: string;

  @Column({ nullable: true })
  openedAt: Date;

  @Column({ nullable: true })
  closedAt: Date;
}
EOF
```

**Step 4: Create trade history entity**

```bash
cat > apps/api/src/entities/trade.entity.ts << 'EOF'
import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum ExitReason {
  STOP_LOSS = 'stop_loss',
  MANUAL = 'manual',
  TARGET = 'target',
  CIRCUIT_BREAKER = 'circuit_breaker',
}

@Entity('trades')
export class Trade extends BaseEntity {
  @Column()
  symbol: string;

  @Column('decimal', { precision: 10, scale: 2 })
  entryPrice: number;

  @Column('decimal', { precision: 10, scale: 2 })
  exitPrice: number;

  @Column('int')
  shares: number;

  @Column('decimal', { precision: 10, scale: 2 })
  pnl: number;

  @Column('decimal', { precision: 5, scale: 2 })
  pnlPercent: number;

  @Column()
  openedAt: Date;

  @Column()
  closedAt: Date;

  @Column({
    type: 'enum',
    enum: ExitReason,
  })
  exitReason: ExitReason;

  @Column('text', { nullable: true })
  notes: string;
}
EOF
```

**Step 5: Create settings entity**

```bash
cat > apps/api/src/entities/settings.entity.ts << 'EOF'
import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('settings')
export class Setting {
  @PrimaryColumn()
  key: string;

  @Column('jsonb')
  value: any;

  @Column()
  updatedAt: Date;
}
EOF
```

**Step 6: Create activity log entity**

```bash
cat > apps/api/src/entities/activity-log.entity.ts << 'EOF'
import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum ActivityType {
  OPPORTUNITY_CREATED = 'opportunity_created',
  OPPORTUNITY_APPROVED = 'opportunity_approved',
  OPPORTUNITY_REJECTED = 'opportunity_rejected',
  ORDER_PLACED = 'order_placed',
  ORDER_FILLED = 'order_filled',
  STOP_TRIGGERED = 'stop_triggered',
  POSITION_CLOSED = 'position_closed',
  CIRCUIT_BREAKER = 'circuit_breaker',
  SETTING_CHANGED = 'setting_changed',
}

@Entity('activity_log')
export class ActivityLog extends BaseEntity {
  @Column({
    type: 'enum',
    enum: ActivityType,
  })
  type: ActivityType;

  @Column()
  message: string;

  @Column('jsonb', { nullable: true })
  details: Record<string, any>;

  @Column({ nullable: true })
  symbol: string;
}
EOF
```

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: create core database entities"
```

---

## Phase 3: Interactive Brokers Integration

### Task 3.1: Create IB Module Structure

**Files:**
- Create: `apps/api/src/ib/ib.module.ts`
- Create: `apps/api/src/ib/ib.service.ts`
- Create: `apps/api/src/ib/ib.types.ts`
- Modify: `apps/api/src/app.module.ts`

**Step 1: Create IB types**

```bash
mkdir -p apps/api/src/ib
cat > apps/api/src/ib/ib.types.ts << 'EOF'
export interface IBConfig {
  host: string;
  port: number;
  clientId: number;
}

export interface IBAccountSummary {
  accountId: string;
  netLiquidation: number;
  availableFunds: number;
  buyingPower: number;
  totalCashValue: number;
}

export interface IBPosition {
  symbol: string;
  position: number;
  avgCost: number;
  marketValue: number;
  unrealizedPnl: number;
}

export interface IBOrder {
  orderId: number;
  symbol: string;
  action: 'BUY' | 'SELL';
  orderType: 'MKT' | 'LMT' | 'STP' | 'TRAIL';
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
  trailStopPrice?: number;
  trailPercent?: number;
  status: string;
}

export interface IBContract {
  symbol: string;
  secType: 'STK';
  exchange: string;
  currency: string;
}

export enum IBConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
}
EOF
```

**Step 2: Create IB service**

```bash
cat > apps/api/src/ib/ib.service.ts << 'EOF'
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IBApi, EventName, Contract, Order, OrderAction, OrderType, SecType } from '@stoqey/ib';
import {
  IBConfig,
  IBAccountSummary,
  IBPosition,
  IBOrder,
  IBConnectionStatus,
} from './ib.types';

@Injectable()
export class IBService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IBService.name);
  private ib: IBApi;
  private config: IBConfig;
  private connectionStatus: IBConnectionStatus = IBConnectionStatus.DISCONNECTED;
  private accountId: string;
  private nextOrderId: number = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.config = {
      host: this.configService.get<string>('IB_HOST', '127.0.0.1'),
      port: this.configService.get<number>('IB_PORT', 7497),
      clientId: this.configService.get<number>('IB_CLIENT_ID', 1),
    };
  }

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  async connect(): Promise<void> {
    this.connectionStatus = IBConnectionStatus.CONNECTING;

    this.ib = new IBApi({
      host: this.config.host,
      port: this.config.port,
      clientId: this.config.clientId,
    });

    this.setupEventHandlers();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.connectionStatus = IBConnectionStatus.ERROR;
        reject(new Error('Connection timeout'));
      }, 10000);

      this.ib.once(EventName.nextValidId, (orderId: number) => {
        clearTimeout(timeout);
        this.nextOrderId = orderId;
        this.connectionStatus = IBConnectionStatus.CONNECTED;
        this.logger.log('Connected to Interactive Brokers');
        resolve();
      });

      this.ib.connect();
    });
  }

  async disconnect(): Promise<void> {
    if (this.ib) {
      this.ib.disconnect();
      this.connectionStatus = IBConnectionStatus.DISCONNECTED;
      this.logger.log('Disconnected from Interactive Brokers');
    }
  }

  private setupEventHandlers(): void {
    this.ib.on(EventName.error, (error: Error, code: number, reqId: number) => {
      this.logger.error(`IB Error [${code}] ReqId ${reqId}: ${error.message}`);
      this.eventEmitter.emit('ib.error', { error, code, reqId });
    });

    this.ib.on(EventName.orderStatus, (orderId, status, filled, remaining, avgFillPrice) => {
      this.logger.log(`Order ${orderId}: ${status}, filled: ${filled}, avg: ${avgFillPrice}`);
      this.eventEmitter.emit('ib.orderStatus', {
        orderId,
        status,
        filled,
        remaining,
        avgFillPrice,
      });
    });

    this.ib.on(EventName.execDetails, (reqId, contract, execution) => {
      this.logger.log(`Execution: ${contract.symbol} ${execution.side} ${execution.shares}@${execution.price}`);
      this.eventEmitter.emit('ib.execution', { reqId, contract, execution });
    });
  }

  getConnectionStatus(): IBConnectionStatus {
    return this.connectionStatus;
  }

  isConnected(): boolean {
    return this.connectionStatus === IBConnectionStatus.CONNECTED;
  }

  private createStockContract(symbol: string): Contract {
    return {
      symbol,
      secType: SecType.STK,
      exchange: 'SMART',
      currency: 'USD',
    };
  }

  private getNextOrderId(): number {
    return this.nextOrderId++;
  }

  async getAccountSummary(): Promise<IBAccountSummary> {
    return new Promise((resolve, reject) => {
      const reqId = Math.floor(Math.random() * 10000);
      const summary: Partial<IBAccountSummary> = {};

      const handler = (rId: number, account: string, tag: string, value: string) => {
        if (rId !== reqId) return;

        this.accountId = account;
        summary.accountId = account;

        switch (tag) {
          case 'NetLiquidation':
            summary.netLiquidation = parseFloat(value);
            break;
          case 'AvailableFunds':
            summary.availableFunds = parseFloat(value);
            break;
          case 'BuyingPower':
            summary.buyingPower = parseFloat(value);
            break;
          case 'TotalCashValue':
            summary.totalCashValue = parseFloat(value);
            break;
        }
      };

      const endHandler = (rId: number) => {
        if (rId !== reqId) return;
        this.ib.off(EventName.accountSummary, handler);
        this.ib.off(EventName.accountSummaryEnd, endHandler);
        resolve(summary as IBAccountSummary);
      };

      this.ib.on(EventName.accountSummary, handler);
      this.ib.on(EventName.accountSummaryEnd, endHandler);

      this.ib.reqAccountSummary(reqId, 'All', 'NetLiquidation,AvailableFunds,BuyingPower,TotalCashValue');

      setTimeout(() => {
        this.ib.off(EventName.accountSummary, handler);
        this.ib.off(EventName.accountSummaryEnd, endHandler);
        reject(new Error('Account summary timeout'));
      }, 5000);
    });
  }

  async getPositions(): Promise<IBPosition[]> {
    return new Promise((resolve, reject) => {
      const positions: IBPosition[] = [];

      const handler = (account: string, contract: Contract, pos: number, avgCost: number) => {
        if (pos !== 0) {
          positions.push({
            symbol: contract.symbol,
            position: pos,
            avgCost,
            marketValue: 0,
            unrealizedPnl: 0,
          });
        }
      };

      const endHandler = () => {
        this.ib.off(EventName.position, handler);
        this.ib.off(EventName.positionEnd, endHandler);
        resolve(positions);
      };

      this.ib.on(EventName.position, handler);
      this.ib.on(EventName.positionEnd, endHandler);

      this.ib.reqPositions();

      setTimeout(() => {
        this.ib.off(EventName.position, handler);
        this.ib.off(EventName.positionEnd, endHandler);
        reject(new Error('Positions timeout'));
      }, 5000);
    });
  }

  async placeBuyOrder(
    symbol: string,
    quantity: number,
    limitPrice?: number,
  ): Promise<number> {
    const contract = this.createStockContract(symbol);
    const orderId = this.getNextOrderId();

    const order: Order = {
      orderId,
      action: OrderAction.BUY,
      orderType: limitPrice ? OrderType.LMT : OrderType.MKT,
      totalQuantity: quantity,
      lmtPrice: limitPrice,
      transmit: true,
    };

    this.ib.placeOrder(orderId, contract, order);
    this.logger.log(`Placed BUY order ${orderId}: ${quantity} ${symbol}${limitPrice ? ` @ ${limitPrice}` : ' MKT'}`);

    return orderId;
  }

  async placeSellOrder(
    symbol: string,
    quantity: number,
    limitPrice?: number,
  ): Promise<number> {
    const contract = this.createStockContract(symbol);
    const orderId = this.getNextOrderId();

    const order: Order = {
      orderId,
      action: OrderAction.SELL,
      orderType: limitPrice ? OrderType.LMT : OrderType.MKT,
      totalQuantity: quantity,
      lmtPrice: limitPrice,
      transmit: true,
    };

    this.ib.placeOrder(orderId, contract, order);
    this.logger.log(`Placed SELL order ${orderId}: ${quantity} ${symbol}${limitPrice ? ` @ ${limitPrice}` : ' MKT'}`);

    return orderId;
  }

  async placeTrailingStopOrder(
    symbol: string,
    quantity: number,
    trailPercent: number,
  ): Promise<number> {
    const contract = this.createStockContract(symbol);
    const orderId = this.getNextOrderId();

    const order: Order = {
      orderId,
      action: OrderAction.SELL,
      orderType: OrderType.TRAIL,
      totalQuantity: quantity,
      trailingPercent: trailPercent,
      transmit: true,
    };

    this.ib.placeOrder(orderId, contract, order);
    this.logger.log(`Placed TRAIL STOP order ${orderId}: ${quantity} ${symbol} @ ${trailPercent}%`);

    return orderId;
  }

  async cancelOrder(orderId: number): Promise<void> {
    this.ib.cancelOrder(orderId);
    this.logger.log(`Cancelled order ${orderId}`);
  }

  async modifyTrailingStop(
    orderId: number,
    symbol: string,
    quantity: number,
    trailPercent: number,
  ): Promise<void> {
    const contract = this.createStockContract(symbol);

    const order: Order = {
      orderId,
      action: OrderAction.SELL,
      orderType: OrderType.TRAIL,
      totalQuantity: quantity,
      trailingPercent: trailPercent,
      transmit: true,
    };

    this.ib.placeOrder(orderId, contract, order);
    this.logger.log(`Modified TRAIL STOP order ${orderId}: ${trailPercent}%`);
  }

  async getQuote(symbol: string): Promise<{ bid: number; ask: number; last: number }> {
    return new Promise((resolve, reject) => {
      const reqId = Math.floor(Math.random() * 10000);
      const contract = this.createStockContract(symbol);
      const quote = { bid: 0, ask: 0, last: 0 };

      const handler = (rId: number, tickType: number, value: number) => {
        if (rId !== reqId) return;

        switch (tickType) {
          case 1: quote.bid = value; break;
          case 2: quote.ask = value; break;
          case 4: quote.last = value; break;
        }

        if (quote.bid && quote.ask && quote.last) {
          this.ib.cancelMktData(reqId);
          this.ib.off(EventName.tickPrice, handler);
          resolve(quote);
        }
      };

      this.ib.on(EventName.tickPrice, handler);
      this.ib.reqMktData(reqId, contract, '', false, false);

      setTimeout(() => {
        this.ib.cancelMktData(reqId);
        this.ib.off(EventName.tickPrice, handler);
        if (quote.last) {
          resolve(quote);
        } else {
          reject(new Error('Quote timeout'));
        }
      }, 5000);
    });
  }
}
EOF
```

**Step 3: Create IB module**

```bash
cat > apps/api/src/ib/ib.module.ts << 'EOF'
import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { IBService } from './ib.service';

@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [IBService],
  exports: [IBService],
})
export class IBModule {}
EOF
```

**Step 4: Add @stoqey/ib and event-emitter to dependencies**

```bash
cd apps/api && npm install @stoqey/ib @nestjs/event-emitter
```

**Step 5: Update app.module.ts**

```bash
cat > apps/api/src/app.module.ts << 'EOF'
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DatabaseModule } from './database/database.module';
import { IBModule } from './ib/ib.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    DatabaseModule,
    IBModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
EOF
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Interactive Brokers integration module"
```

---

### Task 3.2: Create IB Controller and Health Check

**Files:**
- Create: `apps/api/src/ib/ib.controller.ts`
- Create: `apps/api/src/ib/dto/place-order.dto.ts`
- Modify: `apps/api/src/ib/ib.module.ts`

**Step 1: Create DTOs for order placement**

```bash
mkdir -p apps/api/src/ib/dto
cat > apps/api/src/ib/dto/place-order.dto.ts << 'EOF'
import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';

export class PlaceBuyOrderDto {
  @IsString()
  symbol: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  limitPrice?: number;

  @IsNumber()
  @Min(1)
  @Max(50)
  trailPercent: number;
}

export class PlaceSellOrderDto {
  @IsString()
  symbol: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  limitPrice?: number;
}

export class ModifyStopDto {
  @IsNumber()
  orderId: number;

  @IsString()
  symbol: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(1)
  @Max(50)
  trailPercent: number;
}
EOF
```

**Step 2: Create IB controller**

```bash
cat > apps/api/src/ib/ib.controller.ts << 'EOF'
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { IBService } from './ib.service';
import { PlaceBuyOrderDto, PlaceSellOrderDto, ModifyStopDto } from './dto/place-order.dto';

@Controller('ib')
export class IBController {
  constructor(private readonly ibService: IBService) {}

  @Get('status')
  getStatus() {
    return {
      connected: this.ibService.isConnected(),
      status: this.ibService.getConnectionStatus(),
    };
  }

  @Get('account')
  async getAccountSummary() {
    if (!this.ibService.isConnected()) {
      throw new HttpException('Not connected to IB', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return this.ibService.getAccountSummary();
  }

  @Get('positions')
  async getPositions() {
    if (!this.ibService.isConnected()) {
      throw new HttpException('Not connected to IB', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return this.ibService.getPositions();
  }

  @Get('quote/:symbol')
  async getQuote(@Param('symbol') symbol: string) {
    if (!this.ibService.isConnected()) {
      throw new HttpException('Not connected to IB', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return this.ibService.getQuote(symbol.toUpperCase());
  }

  @Post('order/buy')
  async placeBuyOrder(@Body() dto: PlaceBuyOrderDto) {
    if (!this.ibService.isConnected()) {
      throw new HttpException('Not connected to IB', HttpStatus.SERVICE_UNAVAILABLE);
    }

    const buyOrderId = await this.ibService.placeBuyOrder(
      dto.symbol.toUpperCase(),
      dto.quantity,
      dto.limitPrice,
    );

    const stopOrderId = await this.ibService.placeTrailingStopOrder(
      dto.symbol.toUpperCase(),
      dto.quantity,
      dto.trailPercent,
    );

    return {
      buyOrderId,
      stopOrderId,
      message: `Buy order placed with trailing stop at ${dto.trailPercent}%`,
    };
  }

  @Post('order/sell')
  async placeSellOrder(@Body() dto: PlaceSellOrderDto) {
    if (!this.ibService.isConnected()) {
      throw new HttpException('Not connected to IB', HttpStatus.SERVICE_UNAVAILABLE);
    }

    const orderId = await this.ibService.placeSellOrder(
      dto.symbol.toUpperCase(),
      dto.quantity,
      dto.limitPrice,
    );

    return { orderId };
  }

  @Post('order/modify-stop')
  async modifyStop(@Body() dto: ModifyStopDto) {
    if (!this.ibService.isConnected()) {
      throw new HttpException('Not connected to IB', HttpStatus.SERVICE_UNAVAILABLE);
    }

    await this.ibService.modifyTrailingStop(
      dto.orderId,
      dto.symbol.toUpperCase(),
      dto.quantity,
      dto.trailPercent,
    );

    return { message: 'Stop order modified' };
  }

  @Delete('order/:orderId')
  async cancelOrder(@Param('orderId') orderId: string) {
    if (!this.ibService.isConnected()) {
      throw new HttpException('Not connected to IB', HttpStatus.SERVICE_UNAVAILABLE);
    }

    await this.ibService.cancelOrder(parseInt(orderId, 10));
    return { message: 'Order cancelled' };
  }

  @Post('reconnect')
  async reconnect() {
    await this.ibService.disconnect();
    await this.ibService.connect();
    return { status: this.ibService.getConnectionStatus() };
  }
}
EOF
```

**Step 3: Update IB module to include controller**

```bash
cat > apps/api/src/ib/ib.module.ts << 'EOF'
import { Module } from '@nestjs/common';
import { IBService } from './ib.service';
import { IBController } from './ib.controller';

@Module({
  controllers: [IBController],
  providers: [IBService],
  exports: [IBService],
})
export class IBModule {}
EOF
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add IB REST API controller for orders and account"
```

---

### Task 3.3: Create IB Order Event Handlers

**Files:**
- Create: `apps/api/src/ib/ib-events.service.ts`
- Modify: `apps/api/src/ib/ib.module.ts`

**Step 1: Create event handler service**

```bash
cat > apps/api/src/ib/ib-events.service.ts << 'EOF'
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Position, PositionStatus } from '../entities/position.entity';
import { Trade, ExitReason } from '../entities/trade.entity';
import { ActivityLog, ActivityType } from '../entities/activity-log.entity';

interface OrderStatusEvent {
  orderId: number;
  status: string;
  filled: number;
  remaining: number;
  avgFillPrice: number;
}

interface ExecutionEvent {
  reqId: number;
  contract: { symbol: string };
  execution: {
    side: string;
    shares: number;
    price: number;
    orderId: number;
  };
}

@Injectable()
export class IBEventsService {
  private readonly logger = new Logger(IBEventsService.name);

  constructor(
    @InjectRepository(Position)
    private positionRepo: Repository<Position>,
    @InjectRepository(Trade)
    private tradeRepo: Repository<Trade>,
    @InjectRepository(ActivityLog)
    private activityRepo: Repository<ActivityLog>,
  ) {}

  @OnEvent('ib.orderStatus')
  async handleOrderStatus(event: OrderStatusEvent) {
    this.logger.log(`Order ${event.orderId} status: ${event.status}`);

    if (event.status === 'Filled') {
      await this.handleOrderFilled(event);
    } else if (event.status === 'Cancelled') {
      await this.handleOrderCancelled(event);
    }
  }

  @OnEvent('ib.execution')
  async handleExecution(event: ExecutionEvent) {
    const { contract, execution } = event;

    this.logger.log(
      `Execution: ${execution.side} ${execution.shares} ${contract.symbol} @ ${execution.price}`,
    );

    await this.activityRepo.save({
      type: ActivityType.ORDER_FILLED,
      message: `${execution.side} ${execution.shares} ${contract.symbol} @ $${execution.price}`,
      symbol: contract.symbol,
      details: {
        orderId: execution.orderId,
        side: execution.side,
        shares: execution.shares,
        price: execution.price,
      },
    });
  }

  private async handleOrderFilled(event: OrderStatusEvent) {
    // Check if this is an entry order
    const entryPosition = await this.positionRepo.findOne({
      where: { ibOrderId: event.orderId.toString(), status: PositionStatus.PENDING },
    });

    if (entryPosition) {
      entryPosition.status = PositionStatus.OPEN;
      entryPosition.entryPrice = event.avgFillPrice;
      entryPosition.highestPrice = event.avgFillPrice;
      entryPosition.currentPrice = event.avgFillPrice;
      entryPosition.openedAt = new Date();
      await this.positionRepo.save(entryPosition);

      await this.activityRepo.save({
        type: ActivityType.ORDER_FILLED,
        message: `Opened position: ${entryPosition.shares} ${entryPosition.symbol} @ $${event.avgFillPrice}`,
        symbol: entryPosition.symbol,
        details: { positionId: entryPosition.id, avgFillPrice: event.avgFillPrice },
      });
      return;
    }

    // Check if this is a stop order (exit)
    const exitPosition = await this.positionRepo.findOne({
      where: { ibStopOrderId: event.orderId.toString(), status: PositionStatus.OPEN },
    });

    if (exitPosition) {
      await this.closePosition(exitPosition, event.avgFillPrice, ExitReason.STOP_LOSS);
    }
  }

  private async handleOrderCancelled(event: OrderStatusEvent) {
    this.logger.log(`Order ${event.orderId} was cancelled`);
  }

  private async closePosition(
    position: Position,
    exitPrice: number,
    exitReason: ExitReason,
  ) {
    const pnl = (exitPrice - position.entryPrice) * position.shares;
    const pnlPercent = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;

    // Create trade record
    await this.tradeRepo.save({
      symbol: position.symbol,
      entryPrice: position.entryPrice,
      exitPrice,
      shares: position.shares,
      pnl,
      pnlPercent,
      openedAt: position.openedAt,
      closedAt: new Date(),
      exitReason,
    });

    // Update position
    position.status = PositionStatus.CLOSED;
    position.closedAt = new Date();
    await this.positionRepo.save(position);

    await this.activityRepo.save({
      type: ActivityType.POSITION_CLOSED,
      message: `Closed ${position.symbol}: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`,
      symbol: position.symbol,
      details: { positionId: position.id, exitPrice, pnl, pnlPercent, exitReason },
    });

    this.logger.log(
      `Position closed: ${position.symbol} PnL: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`,
    );
  }
}
EOF
```

**Step 2: Update IB module**

```bash
cat > apps/api/src/ib/ib.module.ts << 'EOF'
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IBService } from './ib.service';
import { IBController } from './ib.controller';
import { IBEventsService } from './ib-events.service';
import { Position } from '../entities/position.entity';
import { Trade } from '../entities/trade.entity';
import { ActivityLog } from '../entities/activity-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Position, Trade, ActivityLog])],
  controllers: [IBController],
  providers: [IBService, IBEventsService],
  exports: [IBService],
})
export class IBModule {}
EOF
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add IB order event handlers for position tracking"
```

---

## Phase 4: Data Provider Integration

### Task 4.1: Create Polygon.io Module

**Files:**
- Create: `apps/api/src/data/data.module.ts`
- Create: `apps/api/src/data/polygon.service.ts`
- Create: `apps/api/src/data/data.types.ts`

**Step 1: Create data types**

```bash
mkdir -p apps/api/src/data
cat > apps/api/src/data/data.types.ts << 'EOF'
export interface StockQuote {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  previousClose: number;
  change: number;
  changePercent: number;
  timestamp: Date;
}

export interface StockBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: Date;
}

export interface NewsArticle {
  id: string;
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: Date;
  symbols: string[];
  sentiment?: 'positive' | 'negative' | 'neutral';
}

export interface TechnicalIndicators {
  sma20: number;
  sma50: number;
  rsi: number;
  atr: number;
  volume20Avg: number;
  volumeRatio: number;
}
EOF
```

**Step 2: Create Polygon service**

```bash
cat > apps/api/src/data/polygon.service.ts << 'EOF'
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StockQuote, StockBar, NewsArticle, TechnicalIndicators } from './data.types';

@Injectable()
export class PolygonService {
  private readonly logger = new Logger(PolygonService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.polygon.io';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('POLYGON_API_KEY', '');
    if (!this.apiKey) {
      this.logger.warn('POLYGON_API_KEY not configured');
    }
  }

  private async fetch<T>(endpoint: string): Promise<T> {
    const url = `${this.baseUrl}${endpoint}${endpoint.includes('?') ? '&' : '?'}apiKey=${this.apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Polygon API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getQuote(symbol: string): Promise<StockQuote> {
    const data = await this.fetch<any>(`/v2/aggs/ticker/${symbol}/prev`);

    if (!data.results || data.results.length === 0) {
      throw new Error(`No quote data for ${symbol}`);
    }

    const result = data.results[0];
    const previousClose = result.c;

    // Get current snapshot
    const snapshot = await this.fetch<any>(`/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}`);
    const current = snapshot.ticker;

    return {
      symbol,
      price: current.day?.c || result.c,
      open: current.day?.o || result.o,
      high: current.day?.h || result.h,
      low: current.day?.l || result.l,
      close: current.day?.c || result.c,
      volume: current.day?.v || result.v,
      previousClose,
      change: (current.day?.c || result.c) - previousClose,
      changePercent: (((current.day?.c || result.c) - previousClose) / previousClose) * 100,
      timestamp: new Date(),
    };
  }

  async getBars(
    symbol: string,
    timespan: 'minute' | 'hour' | 'day' = 'day',
    limit: number = 50,
  ): Promise<StockBar[]> {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - limit * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const data = await this.fetch<any>(
      `/v2/aggs/ticker/${symbol}/range/1/${timespan}/${from}/${to}?adjusted=true&sort=asc&limit=${limit}`,
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

  async getNews(symbol?: string, limit: number = 20): Promise<NewsArticle[]> {
    const endpoint = symbol
      ? `/v2/reference/news?ticker=${symbol}&limit=${limit}`
      : `/v2/reference/news?limit=${limit}`;

    const data = await this.fetch<any>(endpoint);

    if (!data.results) {
      return [];
    }

    return data.results.map((article: any) => ({
      id: article.id,
      title: article.title,
      description: article.description || '',
      url: article.article_url,
      source: article.publisher?.name || 'Unknown',
      publishedAt: new Date(article.published_utc),
      symbols: article.tickers || [],
    }));
  }

  async getTechnicalIndicators(symbol: string): Promise<TechnicalIndicators> {
    const bars = await this.getBars(symbol, 'day', 50);

    if (bars.length < 20) {
      throw new Error(`Insufficient data for ${symbol}`);
    }

    // Calculate SMA 20
    const sma20 = bars.slice(-20).reduce((sum, bar) => sum + bar.close, 0) / 20;

    // Calculate SMA 50 (or use available data)
    const sma50 = bars.reduce((sum, bar) => sum + bar.close, 0) / bars.length;

    // Calculate RSI (14-period)
    const rsi = this.calculateRSI(bars.slice(-15));

    // Calculate ATR (14-period)
    const atr = this.calculateATR(bars.slice(-15));

    // Volume analysis
    const volume20Avg = bars.slice(-20).reduce((sum, bar) => sum + bar.volume, 0) / 20;
    const currentVolume = bars[bars.length - 1].volume;
    const volumeRatio = currentVolume / volume20Avg;

    return {
      sma20,
      sma50,
      rsi,
      atr,
      volume20Avg,
      volumeRatio,
    };
  }

  private calculateRSI(bars: StockBar[]): number {
    if (bars.length < 2) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i < bars.length; i++) {
      const change = bars[i].close - bars[i - 1].close;
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }

    const avgGain = gains / (bars.length - 1);
    const avgLoss = losses / (bars.length - 1);

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private calculateATR(bars: StockBar[]): number {
    if (bars.length < 2) return 0;

    let trSum = 0;

    for (let i = 1; i < bars.length; i++) {
      const high = bars[i].high;
      const low = bars[i].low;
      const prevClose = bars[i - 1].close;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose),
      );
      trSum += tr;
    }

    return trSum / (bars.length - 1);
  }
}
EOF
```

**Step 3: Create Finnhub service for supplemental news**

```bash
cat > apps/api/src/data/finnhub.service.ts << 'EOF'
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NewsArticle } from './data.types';

@Injectable()
export class FinnhubService {
  private readonly logger = new Logger(FinnhubService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://finnhub.io/api/v1';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('FINNHUB_API_KEY', '');
    if (!this.apiKey) {
      this.logger.warn('FINNHUB_API_KEY not configured');
    }
  }

  private async fetch<T>(endpoint: string): Promise<T> {
    const url = `${this.baseUrl}${endpoint}${endpoint.includes('?') ? '&' : '?'}token=${this.apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Finnhub API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getCompanyNews(symbol: string, daysBack: number = 7): Promise<NewsArticle[]> {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const data = await this.fetch<any[]>(`/company-news?symbol=${symbol}&from=${from}&to=${to}`);

    return data.slice(0, 20).map((article) => ({
      id: article.id?.toString() || article.url,
      title: article.headline,
      description: article.summary || '',
      url: article.url,
      source: article.source,
      publishedAt: new Date(article.datetime * 1000),
      symbols: [symbol],
    }));
  }

  async getNewsSentiment(symbol: string): Promise<{ score: number; buzz: number }> {
    const data = await this.fetch<any>(`/news-sentiment?symbol=${symbol}`);

    return {
      score: data.sentiment?.bullishPercent || 0.5,
      buzz: data.buzz?.articlesInLastWeek || 0,
    };
  }

  async getMarketNews(category: 'general' | 'forex' | 'crypto' | 'merger' = 'general'): Promise<NewsArticle[]> {
    const data = await this.fetch<any[]>(`/news?category=${category}`);

    return data.slice(0, 20).map((article) => ({
      id: article.id?.toString() || article.url,
      title: article.headline,
      description: article.summary || '',
      url: article.url,
      source: article.source,
      publishedAt: new Date(article.datetime * 1000),
      symbols: article.related?.split(',') || [],
    }));
  }
}
EOF
```

**Step 4: Create data module**

```bash
cat > apps/api/src/data/data.module.ts << 'EOF'
import { Module } from '@nestjs/common';
import { PolygonService } from './polygon.service';
import { FinnhubService } from './finnhub.service';

@Module({
  providers: [PolygonService, FinnhubService],
  exports: [PolygonService, FinnhubService],
})
export class DataModule {}
EOF
```

**Step 5: Update app.module.ts**

```bash
cat > apps/api/src/app.module.ts << 'EOF'
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DatabaseModule } from './database/database.module';
import { IBModule } from './ib/ib.module';
import { DataModule } from './data/data.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    DatabaseModule,
    IBModule,
    DataModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
EOF
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Polygon.io and Finnhub data providers"
```

---

## Phase 5: Strategy Engine

### Task 5.1: Create Scoring Service

**Files:**
- Create: `apps/api/src/strategy/strategy.module.ts`
- Create: `apps/api/src/strategy/scoring.service.ts`
- Create: `apps/api/src/strategy/strategy.types.ts`

**Step 1: Create strategy types**

```bash
mkdir -p apps/api/src/strategy
cat > apps/api/src/strategy/strategy.types.ts << 'EOF'
export interface ScoringWeights {
  volumeSurge: number;
  technicalBreakout: number;
  sectorMomentum: number;
  newsSentiment: number;
  volatilityFit: number;
}

export interface ScoringFactors {
  volumeSurge: number;
  technicalBreakout: number;
  sectorMomentum: number;
  newsSentiment: number;
  volatilityFit: number;
}

export interface OpportunityScore {
  symbol: string;
  totalScore: number;
  factors: ScoringFactors;
  currentPrice: number;
  suggestedEntry: number;
  suggestedTrailPercent: number;
  confidence: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  volumeSurge: 25,
  technicalBreakout: 25,
  sectorMomentum: 20,
  newsSentiment: 15,
  volatilityFit: 15,
};
EOF
```

**Step 2: Create scoring service**

```bash
cat > apps/api/src/strategy/scoring.service.ts << 'EOF'
import { Injectable, Logger } from '@nestjs/common';
import { PolygonService } from '../data/polygon.service';
import { FinnhubService } from '../data/finnhub.service';
import {
  ScoringWeights,
  ScoringFactors,
  OpportunityScore,
  DEFAULT_WEIGHTS,
} from './strategy.types';

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);
  private weights: ScoringWeights = DEFAULT_WEIGHTS;

  constructor(
    private readonly polygonService: PolygonService,
    private readonly finnhubService: FinnhubService,
  ) {}

  setWeights(weights: Partial<ScoringWeights>): void {
    this.weights = { ...this.weights, ...weights };
  }

  async scoreStock(symbol: string): Promise<OpportunityScore> {
    try {
      const [quote, indicators, sentiment] = await Promise.all([
        this.polygonService.getQuote(symbol),
        this.polygonService.getTechnicalIndicators(symbol),
        this.finnhubService.getNewsSentiment(symbol).catch(() => ({ score: 0.5, buzz: 0 })),
      ]);

      const factors = this.calculateFactors(quote, indicators, sentiment);
      const totalScore = this.calculateTotalScore(factors);

      // Calculate suggested trail percent based on ATR
      const atrPercent = (indicators.atr / quote.price) * 100;
      const suggestedTrailPercent = Math.max(5, Math.min(15, atrPercent * 2));

      return {
        symbol,
        totalScore,
        factors,
        currentPrice: quote.price,
        suggestedEntry: quote.price,
        suggestedTrailPercent: Math.round(suggestedTrailPercent * 10) / 10,
        confidence: this.calculateConfidence(factors, indicators),
      };
    } catch (error) {
      this.logger.error(`Failed to score ${symbol}: ${error.message}`);
      throw error;
    }
  }

  private calculateFactors(
    quote: any,
    indicators: any,
    sentiment: { score: number; buzz: number },
  ): ScoringFactors {
    // Volume Surge (0-100)
    let volumeSurge = 0;
    if (indicators.volumeRatio >= 3) {
      volumeSurge = 100;
    } else if (indicators.volumeRatio >= 2) {
      volumeSurge = 60 + (indicators.volumeRatio - 2) * 40;
    } else if (indicators.volumeRatio >= 1.5) {
      volumeSurge = 30 + (indicators.volumeRatio - 1.5) * 60;
    } else {
      volumeSurge = indicators.volumeRatio * 20;
    }

    // Technical Breakout (0-100)
    let technicalBreakout = 0;
    const priceVsSma20 = (quote.price - indicators.sma20) / indicators.sma20;
    const priceVsSma50 = (quote.price - indicators.sma50) / indicators.sma50;

    if (priceVsSma20 > 0) technicalBreakout += 40;
    if (priceVsSma50 > 0) technicalBreakout += 30;
    if (indicators.rsi > 50 && indicators.rsi < 70) technicalBreakout += 30;
    else if (indicators.rsi >= 70) technicalBreakout += 10; // Overbought warning

    // Sector Momentum (0-100) - simplified, would need sector data
    const sectorMomentum = quote.changePercent > 0 ? Math.min(100, quote.changePercent * 20 + 50) : Math.max(0, 50 + quote.changePercent * 10);

    // News Sentiment (0-100)
    const newsSentiment = sentiment.score * 100;

    // Volatility Fit (0-100)
    // Sweet spot: ATR between 2-5% of price
    const atrPercent = (indicators.atr / quote.price) * 100;
    let volatilityFit = 0;
    if (atrPercent >= 2 && atrPercent <= 5) {
      volatilityFit = 100;
    } else if (atrPercent < 2) {
      volatilityFit = atrPercent * 50;
    } else if (atrPercent <= 8) {
      volatilityFit = 100 - (atrPercent - 5) * 20;
    } else {
      volatilityFit = Math.max(0, 40 - (atrPercent - 8) * 10);
    }

    return {
      volumeSurge: Math.round(volumeSurge),
      technicalBreakout: Math.round(technicalBreakout),
      sectorMomentum: Math.round(sectorMomentum),
      newsSentiment: Math.round(newsSentiment),
      volatilityFit: Math.round(volatilityFit),
    };
  }

  private calculateTotalScore(factors: ScoringFactors): number {
    const totalWeight = Object.values(this.weights).reduce((a, b) => a + b, 0);

    const weightedScore =
      (factors.volumeSurge * this.weights.volumeSurge +
        factors.technicalBreakout * this.weights.technicalBreakout +
        factors.sectorMomentum * this.weights.sectorMomentum +
        factors.newsSentiment * this.weights.newsSentiment +
        factors.volatilityFit * this.weights.volatilityFit) /
      totalWeight;

    return Math.round(weightedScore);
  }

  private calculateConfidence(factors: ScoringFactors, indicators: any): number {
    // Higher confidence when multiple factors align
    const factorValues = Object.values(factors);
    const aboveThreshold = factorValues.filter((v) => v >= 60).length;
    const baseConfidence = (aboveThreshold / factorValues.length) * 100;

    // Adjust for RSI extremes
    let rsiAdjustment = 0;
    if (indicators.rsi > 80 || indicators.rsi < 20) {
      rsiAdjustment = -20;
    } else if (indicators.rsi > 70 || indicators.rsi < 30) {
      rsiAdjustment = -10;
    }

    return Math.round(Math.max(0, Math.min(100, baseConfidence + rsiAdjustment)));
  }

  async scoreMultiple(symbols: string[]): Promise<OpportunityScore[]> {
    const results = await Promise.allSettled(
      symbols.map((symbol) => this.scoreStock(symbol)),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<OpportunityScore> => r.status === 'fulfilled')
      .map((r) => r.value)
      .sort((a, b) => b.totalScore - a.totalScore);
  }
}
EOF
```

**Step 3: Create strategy module**

```bash
cat > apps/api/src/strategy/strategy.module.ts << 'EOF'
import { Module } from '@nestjs/common';
import { DataModule } from '../data/data.module';
import { ScoringService } from './scoring.service';

@Module({
  imports: [DataModule],
  providers: [ScoringService],
  exports: [ScoringService],
})
export class StrategyModule {}
EOF
```

**Step 4: Update app.module.ts**

```bash
cat > apps/api/src/app.module.ts << 'EOF'
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DatabaseModule } from './database/database.module';
import { IBModule } from './ib/ib.module';
import { DataModule } from './data/data.module';
import { StrategyModule } from './strategy/strategy.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    DatabaseModule,
    IBModule,
    DataModule,
    StrategyModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
EOF
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add multi-factor stock scoring service"
```

---

## Phase 6: AI Agent Layer

### Task 6.1: Create AI Module with Claude Integration

**Files:**
- Create: `apps/api/src/ai/ai.module.ts`
- Create: `apps/api/src/ai/ai.service.ts`
- Create: `apps/api/src/ai/prompts.ts`

**Step 1: Install Anthropic SDK**

```bash
cd apps/api && npm install @anthropic-ai/sdk
```

**Step 2: Create AI prompts**

```bash
mkdir -p apps/api/src/ai
cat > apps/api/src/ai/prompts.ts << 'EOF'
export const NEWS_ANALYSIS_PROMPT = `You are a financial news analyst. Analyze the following news article about a stock and provide:

1. A brief summary (2-3 sentences)
2. Sentiment: positive, negative, or neutral
3. Key facts that could impact the stock price
4. Risk flags (if any): earnings, lawsuits, FDA decisions, leadership changes, etc.
5. Potential price impact: high, medium, low

Article about {symbol}:
{article}

Respond in JSON format:
{
  "summary": "...",
  "sentiment": "positive|negative|neutral",
  "keyFacts": ["...", "..."],
  "riskFlags": ["...", "..."],
  "priceImpact": "high|medium|low"
}`;

export const TRADE_REASONING_PROMPT = `You are a trading analyst assistant. Based on the following data, provide a trade recommendation:

Stock: {symbol}
Current Price: ${currentPrice}
Score: {score}/100

Technical Factors:
- Volume Surge: {volumeSurge}/100
- Technical Breakout: {technicalBreakout}/100
- Sector Momentum: {sectorMomentum}/100
- News Sentiment: {newsSentiment}/100
- Volatility Fit: {volatilityFit}/100

Technical Indicators:
- SMA20: {sma20}
- SMA50: {sma50}
- RSI: {rsi}
- ATR: {atr}

Recent News:
{newsHeadlines}

Provide your analysis in JSON format:
{
  "recommendation": "BUY|HOLD|AVOID",
  "summary": "2-3 sentence explanation of why this is interesting or not",
  "bullCase": "What could go right",
  "bearCase": "What could go wrong",
  "confidence": 0-100,
  "suggestedEntry": price,
  "suggestedTrailPercent": percentage,
  "warnings": ["any concerns..."]
}`;

export const RISK_ASSESSMENT_PROMPT = `You are a portfolio risk manager. Evaluate whether this trade should proceed:

Proposed Trade:
- Symbol: {symbol}
- Position Size: ${positionSize} ({positionPercent}% of portfolio)
- Entry: ${entry}
- Trail Stop: {trailPercent}%

Current Portfolio:
- Total Value: ${portfolioValue}
- Cash Available: ${cashAvailable}
- Current Positions: {currentPositions}
- Sector Exposure: {sectorExposure}

Market Context:
- VIX Level: {vix}
- Market Trend: {marketTrend}
- Upcoming Events: {upcomingEvents}

Evaluate and respond in JSON:
{
  "recommendation": "GO|CAUTION|STOP",
  "reason": "Brief explanation",
  "concerns": ["list of concerns if any"],
  "sectorWarning": true|false,
  "correlationWarning": true|false,
  "suggestedAdjustments": "any suggested changes to position size or stops"
}`;
EOF
```

**Step 3: Create AI service**

```bash
cat > apps/api/src/ai/ai.service.ts << 'EOF'
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { NEWS_ANALYSIS_PROMPT, TRADE_REASONING_PROMPT, RISK_ASSESSMENT_PROMPT } from './prompts';

export interface NewsAnalysis {
  summary: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  keyFacts: string[];
  riskFlags: string[];
  priceImpact: 'high' | 'medium' | 'low';
}

export interface TradeReasoning {
  recommendation: 'BUY' | 'HOLD' | 'AVOID';
  summary: string;
  bullCase: string;
  bearCase: string;
  confidence: number;
  suggestedEntry: number;
  suggestedTrailPercent: number;
  warnings: string[];
}

export interface RiskAssessment {
  recommendation: 'GO' | 'CAUTION' | 'STOP';
  reason: string;
  concerns: string[];
  sectorWarning: boolean;
  correlationWarning: boolean;
  suggestedAdjustments: string;
}

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);
  private client: Anthropic;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY', '');
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
    } else {
      this.logger.warn('ANTHROPIC_API_KEY not configured - AI features disabled');
    }
  }

  private async chat(prompt: string): Promise<string> {
    if (!this.client) {
      throw new Error('AI service not configured');
    }

    const message = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = message.content.find((block) => block.type === 'text');
    return textBlock ? textBlock.text : '';
  }

  private parseJSON<T>(response: string): T {
    // Extract JSON from response (handles markdown code blocks)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    return JSON.parse(jsonMatch[0]);
  }

  async analyzeNews(symbol: string, article: string): Promise<NewsAnalysis> {
    const prompt = NEWS_ANALYSIS_PROMPT
      .replace('{symbol}', symbol)
      .replace('{article}', article);

    try {
      const response = await this.chat(prompt);
      return this.parseJSON<NewsAnalysis>(response);
    } catch (error) {
      this.logger.error(`News analysis failed: ${error.message}`);
      return {
        summary: 'Analysis unavailable',
        sentiment: 'neutral',
        keyFacts: [],
        riskFlags: [],
        priceImpact: 'low',
      };
    }
  }

  async getTradeReasoning(params: {
    symbol: string;
    currentPrice: number;
    score: number;
    factors: Record<string, number>;
    indicators: Record<string, number>;
    newsHeadlines: string[];
  }): Promise<TradeReasoning> {
    let prompt = TRADE_REASONING_PROMPT
      .replace('{symbol}', params.symbol)
      .replace('{currentPrice}', params.currentPrice.toString())
      .replace('{score}', params.score.toString())
      .replace('{volumeSurge}', params.factors.volumeSurge.toString())
      .replace('{technicalBreakout}', params.factors.technicalBreakout.toString())
      .replace('{sectorMomentum}', params.factors.sectorMomentum.toString())
      .replace('{newsSentiment}', params.factors.newsSentiment.toString())
      .replace('{volatilityFit}', params.factors.volatilityFit.toString())
      .replace('{sma20}', params.indicators.sma20?.toFixed(2) || 'N/A')
      .replace('{sma50}', params.indicators.sma50?.toFixed(2) || 'N/A')
      .replace('{rsi}', params.indicators.rsi?.toFixed(1) || 'N/A')
      .replace('{atr}', params.indicators.atr?.toFixed(2) || 'N/A')
      .replace('{newsHeadlines}', params.newsHeadlines.join('\n') || 'No recent news');

    try {
      const response = await this.chat(prompt);
      return this.parseJSON<TradeReasoning>(response);
    } catch (error) {
      this.logger.error(`Trade reasoning failed: ${error.message}`);
      return {
        recommendation: 'HOLD',
        summary: 'AI analysis unavailable',
        bullCase: 'Unable to analyze',
        bearCase: 'Unable to analyze',
        confidence: 50,
        suggestedEntry: params.currentPrice,
        suggestedTrailPercent: 10,
        warnings: ['AI analysis failed'],
      };
    }
  }

  async assessRisk(params: {
    symbol: string;
    positionSize: number;
    positionPercent: number;
    entry: number;
    trailPercent: number;
    portfolioValue: number;
    cashAvailable: number;
    currentPositions: string;
    sectorExposure: string;
    vix?: number;
    marketTrend?: string;
    upcomingEvents?: string;
  }): Promise<RiskAssessment> {
    let prompt = RISK_ASSESSMENT_PROMPT
      .replace('{symbol}', params.symbol)
      .replace('{positionSize}', params.positionSize.toString())
      .replace('{positionPercent}', params.positionPercent.toString())
      .replace('{entry}', params.entry.toString())
      .replace('{trailPercent}', params.trailPercent.toString())
      .replace('{portfolioValue}', params.portfolioValue.toString())
      .replace('{cashAvailable}', params.cashAvailable.toString())
      .replace('{currentPositions}', params.currentPositions || 'None')
      .replace('{sectorExposure}', params.sectorExposure || 'None')
      .replace('{vix}', params.vix?.toString() || 'Unknown')
      .replace('{marketTrend}', params.marketTrend || 'Unknown')
      .replace('{upcomingEvents}', params.upcomingEvents || 'None known');

    try {
      const response = await this.chat(prompt);
      return this.parseJSON<RiskAssessment>(response);
    } catch (error) {
      this.logger.error(`Risk assessment failed: ${error.message}`);
      return {
        recommendation: 'CAUTION',
        reason: 'AI risk assessment unavailable',
        concerns: ['Unable to perform AI analysis'],
        sectorWarning: false,
        correlationWarning: false,
        suggestedAdjustments: 'Proceed with caution',
      };
    }
  }
}
EOF
```

**Step 4: Create AI module**

```bash
cat > apps/api/src/ai/ai.module.ts << 'EOF'
import { Module } from '@nestjs/common';
import { AIService } from './ai.service';

@Module({
  providers: [AIService],
  exports: [AIService],
})
export class AIModule {}
EOF
```

**Step 5: Update app.module.ts**

```bash
cat > apps/api/src/app.module.ts << 'EOF'
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DatabaseModule } from './database/database.module';
import { IBModule } from './ib/ib.module';
import { DataModule } from './data/data.module';
import { StrategyModule } from './strategy/strategy.module';
import { AIModule } from './ai/ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    DatabaseModule,
    IBModule,
    DataModule,
    StrategyModule,
    AIModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
EOF
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add AI agent layer with Claude integration"
```

---

## Phase 7: Opportunity Scanner

### Task 7.1: Create Scanner Service with Scheduling

**Files:**
- Create: `apps/api/src/scanner/scanner.module.ts`
- Create: `apps/api/src/scanner/scanner.service.ts`

**Step 1: Create scanner service**

```bash
mkdir -p apps/api/src/scanner
cat > apps/api/src/scanner/scanner.service.ts << 'EOF'
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WatchlistItem } from '../entities/watchlist.entity';
import { Opportunity, OpportunityStatus } from '../entities/opportunity.entity';
import { ScoringService } from '../strategy/scoring.service';
import { AIService } from '../ai/ai.service';
import { PolygonService } from '../data/polygon.service';

@Injectable()
export class ScannerService {
  private readonly logger = new Logger(ScannerService.name);
  private isScanning = false;
  private scoreThreshold = 50;

  constructor(
    @InjectRepository(WatchlistItem)
    private watchlistRepo: Repository<WatchlistItem>,
    @InjectRepository(Opportunity)
    private opportunityRepo: Repository<Opportunity>,
    private readonly scoringService: ScoringService,
    private readonly aiService: AIService,
    private readonly polygonService: PolygonService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // Run every 5 minutes during market hours (9:30 AM - 4:00 PM ET, Mon-Fri)
  @Cron('*/5 9-16 * * 1-5', { timeZone: 'America/New_York' })
  async scheduledScan() {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();

    // More precise market hours check
    if (hour === 9 && minute < 30) return;
    if (hour === 16 && minute > 0) return;

    await this.scanWatchlist();
  }

  async scanWatchlist(): Promise<Opportunity[]> {
    if (this.isScanning) {
      this.logger.warn('Scan already in progress, skipping');
      return [];
    }

    this.isScanning = true;
    this.logger.log('Starting watchlist scan');

    try {
      // Get active watchlist items
      const watchlist = await this.watchlistRepo.find({
        where: { active: true },
      });

      if (watchlist.length === 0) {
        this.logger.log('No items in watchlist');
        return [];
      }

      const symbols = watchlist.map((item) => item.symbol);
      this.logger.log(`Scanning ${symbols.length} symbols`);

      // Score all stocks
      const scores = await this.scoringService.scoreMultiple(symbols);

      // Filter by threshold and create opportunities
      const opportunities: Opportunity[] = [];

      for (const score of scores) {
        if (score.totalScore < this.scoreThreshold) continue;

        // Check if we already have a pending opportunity for this symbol
        const existing = await this.opportunityRepo.findOne({
          where: {
            symbol: score.symbol,
            status: OpportunityStatus.PENDING,
            expiresAt: MoreThan(new Date()),
          },
        });

        if (existing) {
          // Update existing opportunity
          existing.score = score.totalScore;
          existing.factors = score.factors;
          existing.currentPrice = score.currentPrice;
          await this.opportunityRepo.save(existing);
          opportunities.push(existing);
          continue;
        }

        // Get AI analysis for high-scoring opportunities
        let aiAnalysis = null;
        if (score.totalScore >= 70) {
          try {
            const news = await this.polygonService.getNews(score.symbol, 5);
            const indicators = await this.polygonService.getTechnicalIndicators(score.symbol);

            aiAnalysis = await this.aiService.getTradeReasoning({
              symbol: score.symbol,
              currentPrice: score.currentPrice,
              score: score.totalScore,
              factors: score.factors,
              indicators,
              newsHeadlines: news.map((n) => n.title),
            });
          } catch (error) {
            this.logger.warn(`AI analysis failed for ${score.symbol}: ${error.message}`);
          }
        }

        // Create new opportunity
        const opportunity = this.opportunityRepo.create({
          symbol: score.symbol,
          score: score.totalScore,
          factors: score.factors,
          currentPrice: score.currentPrice,
          aiAnalysis: aiAnalysis?.summary,
          bullCase: aiAnalysis?.bullCase,
          bearCase: aiAnalysis?.bearCase,
          aiConfidence: aiAnalysis?.confidence,
          suggestedEntry: aiAnalysis?.suggestedEntry || score.suggestedEntry,
          suggestedTrailPercent: aiAnalysis?.suggestedTrailPercent || score.suggestedTrailPercent,
          status: OpportunityStatus.PENDING,
          expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000), // 4 hours
        });

        await this.opportunityRepo.save(opportunity);
        opportunities.push(opportunity);

        this.eventEmitter.emit('opportunity.created', opportunity);
      }

      this.logger.log(`Scan complete: ${opportunities.length} opportunities found`);
      return opportunities;
    } finally {
      this.isScanning = false;
    }
  }

  async manualScan(symbols?: string[]): Promise<Opportunity[]> {
    if (symbols && symbols.length > 0) {
      // Add to watchlist temporarily
      for (const symbol of symbols) {
        const existing = await this.watchlistRepo.findOne({
          where: { symbol: symbol.toUpperCase() },
        });
        if (!existing) {
          await this.watchlistRepo.save({
            symbol: symbol.toUpperCase(),
            active: true,
            fromScreener: true,
          });
        }
      }
    }

    return this.scanWatchlist();
  }

  setThreshold(threshold: number): void {
    this.scoreThreshold = Math.max(0, Math.min(100, threshold));
    this.logger.log(`Score threshold set to ${this.scoreThreshold}`);
  }
}
EOF
```

**Step 2: Create scanner module**

```bash
cat > apps/api/src/scanner/scanner.module.ts << 'EOF'
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScannerService } from './scanner.service';
import { WatchlistItem } from '../entities/watchlist.entity';
import { Opportunity } from '../entities/opportunity.entity';
import { StrategyModule } from '../strategy/strategy.module';
import { AIModule } from '../ai/ai.module';
import { DataModule } from '../data/data.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WatchlistItem, Opportunity]),
    StrategyModule,
    AIModule,
    DataModule,
  ],
  providers: [ScannerService],
  exports: [ScannerService],
})
export class ScannerModule {}
EOF
```

**Step 3: Update app.module.ts**

```bash
cat > apps/api/src/app.module.ts << 'EOF'
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    DatabaseModule,
    IBModule,
    DataModule,
    StrategyModule,
    AIModule,
    ScannerModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
EOF
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add scheduled opportunity scanner with AI analysis"
```

---

## Remaining Phases (Summary)

The plan continues with these additional phases:

### Phase 8: Safety & Guardrails Module
- Circuit breaker service (daily/weekly loss limits)
- Order validation service
- Paper trading gate

### Phase 9: Trading Service
- Trade execution with position tracking
- Trailing stop management
- Manual close functionality

### Phase 10: WebSocket Gateway
- Real-time price updates
- Opportunity notifications
- Position updates

### Phase 11: REST API Controllers
- Opportunities controller
- Positions controller
- Watchlist controller
- Settings controller
- Activity log controller

### Phase 12: Next.js Dashboard
- Dashboard layout and navigation
- Opportunities panel
- Active positions view
- Portfolio overview
- Settings page

### Phase 13: Notifications
- Configurable push notifications
- Telegram/email integration

### Phase 14: Testing & Deployment
- Unit tests for services
- Integration tests
- Docker configuration
- Deployment scripts

---

**Plan complete and saved to `docs/plans/2025-12-27-tradeguard-implementation.md`.**

**Two execution options:**

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
