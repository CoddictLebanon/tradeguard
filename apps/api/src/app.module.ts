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
