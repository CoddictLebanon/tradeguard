// apps/api/src/strategy/trade-setup.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { ExtendedTechnicalIndicators } from '../data/data.types';
import { TradeSetupType } from './conservative-trading.types';

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
      indicators.rsi >= 30 &&
      indicators.rsi <= 45
    ) {
      // Stop below recent swing low or 1.5x ATR below entry
      const atrStop = currentPrice - (indicators.atr * 1.5);
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
      indicators.rsi < 65
    ) {
      // Stop below the MA by 1.5x ATR
      const stopPrice = maValue - (indicators.atr * 1.5);
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
      indicators.rsi < 35 &&
      indicators.priceVsSma20Percent < -5
    ) {
      // Stop at 2x ATR below
      const stopPrice = currentPrice - (indicators.atr * 2);
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
