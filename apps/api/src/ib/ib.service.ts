import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IBApi, EventName, Contract, Order, OrderAction, OrderType, SecType } from '@stoqey/ib';
import {
  IBConfig,
  IBAccountSummary,
  IBPosition,
  IBConnectionStatus,
} from './ib.types';
import { CircuitBreakerService } from '../safety/circuit-breaker.service';
import { PolygonService } from '../data/polygon.service';

@Injectable()
export class IBService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IBService.name);
  private ib: IBApi;
  private config: IBConfig;
  private connectionStatus: IBConnectionStatus = IBConnectionStatus.DISCONNECTED;
  private accountId: string;
  private nextOrderId: number = 0;
  private paperOrderId: number = 100000; // Paper trading order IDs start at 100000

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => CircuitBreakerService))
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly polygonService: PolygonService,
  ) {
    this.config = {
      host: this.configService.get<string>('IB_HOST', '127.0.0.1'),
      port: this.configService.get<number>('IB_PORT', 7497),
      clientId: this.configService.get<number>('IB_CLIENT_ID', 1),
    };
  }

  async onModuleInit() {
    // Don't auto-connect in development if IB not available
    if (this.configService.get<string>('NODE_ENV') === 'development') {
      this.logger.log('Development mode - IB connection deferred until explicit connect');
      return;
    }
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

      const cleanup = () => {
        this.ib.off(EventName.accountSummary, handler);
        this.ib.off(EventName.accountSummaryEnd, endHandler);
        try {
          this.ib.cancelAccountSummary(reqId);
        } catch {
          // Ignore cancel errors
        }
      };

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
        cleanup();
        resolve(summary as IBAccountSummary);
      };

      this.ib.on(EventName.accountSummary, handler);
      this.ib.on(EventName.accountSummaryEnd, endHandler);

      this.ib.reqAccountSummary(reqId, 'All', 'NetLiquidation,AvailableFunds,BuyingPower,TotalCashValue');

      setTimeout(() => {
        cleanup();
        reject(new Error('Account summary timeout'));
      }, 5000);
    });
  }

  async getPositions(): Promise<IBPosition[]> {
    return new Promise((resolve, reject) => {
      const positions: IBPosition[] = [];

      const handler = (account: string, contract: Contract, pos: number, avgCost: number) => {
        if (pos !== 0 && contract.symbol) {
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
        (this.ib as any).off(EventName.position, handler);
        (this.ib as any).off(EventName.positionEnd, endHandler);
        resolve(positions);
      };

      (this.ib as any).on(EventName.position, handler);
      (this.ib as any).on(EventName.positionEnd, endHandler);

      this.ib.reqPositions();

      setTimeout(() => {
        (this.ib as any).off(EventName.position, handler);
        (this.ib as any).off(EventName.positionEnd, endHandler);
        reject(new Error('Positions timeout'));
      }, 5000);
    });
  }

  async placeBuyOrder(
    symbol: string,
    quantity: number,
    limitPrice?: number,
  ): Promise<number> {
    // Try to place order via Python proxy
    try {
      const response = await fetch('http://localhost:6680/order/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, quantity }),
      });

      const result = await response.json() as { success: boolean; orderId?: number; error?: string };

      // If proxy returned an error (including "Not connected to IB"), fail the order
      if (!response.ok || !result.success) {
        const errorMsg = result.error || `Order failed with status ${response.status}`;
        this.logger.error(`[IB PROXY] BUY order failed: ${errorMsg}`);
        throw new Error(errorMsg);
      }

      if (result.orderId) {
        this.logger.log(`[IB PROXY] BUY order placed: ${result.orderId} - ${quantity} ${symbol}`);
        return result.orderId;
      }

      throw new Error('Order placed but no orderId returned');
    } catch (proxyError) {
      // Check if this is a network error (proxy unreachable) vs IB Gateway error
      const errorMessage = (proxyError as Error).message;

      // If it's an IB Gateway connection error, propagate it - don't simulate
      if (errorMessage.includes('Not connected') || errorMessage.includes('IB')) {
        this.logger.error(`[IB] Cannot place order - IB Gateway disconnected: ${errorMessage}`);
        throw proxyError;
      }

      // Only fall back to simulation if proxy is completely unreachable (network error)
      if (errorMessage.includes('fetch') || errorMessage.includes('ECONNREFUSED')) {
        this.logger.warn(`IB Proxy unreachable, falling back to simulation: ${errorMessage}`);
        return this.simulateBuyOrder(symbol, quantity, limitPrice);
      }

      // Any other error should propagate
      throw proxyError;
    }
  }

  private async simulateBuyOrder(
    symbol: string,
    quantity: number,
    limitPrice?: number,
  ): Promise<number> {
    const orderId = this.paperOrderId++;
    const fillPrice = limitPrice || (await this.getSimulatedPrice(symbol));

    this.logger.log(`[PAPER] Simulated BUY order ${orderId}: ${quantity} ${symbol} @ ${fillPrice}`);

    // Emit simulated order status events
    setTimeout(() => {
      this.eventEmitter.emit('ib.orderStatus', {
        orderId,
        status: 'Filled',
        filled: quantity,
        remaining: 0,
        avgFillPrice: fillPrice,
        isPaper: true,
      });

      this.eventEmitter.emit('ib.execution', {
        reqId: orderId,
        contract: { symbol },
        execution: {
          side: 'BUY',
          shares: quantity,
          price: fillPrice,
          orderId,
          isPaper: true,
        },
      });
    }, 100); // Small delay to simulate network latency

    return orderId;
  }

  private async getSimulatedPrice(symbol: string): Promise<number> {
    try {
      const quote = await this.polygonService.getQuote(symbol);
      this.logger.log(`[PAPER] Got real price for ${symbol}: $${quote.price}`);
      return quote.price;
    } catch (error) {
      this.logger.error(`[PAPER] Failed to get price for ${symbol}: ${error}`);
      throw new Error(`Cannot get price for ${symbol} - Polygon API failed`);
    }
  }

  async placeSellOrder(
    symbol: string,
    quantity: number,
    limitPrice?: number,
  ): Promise<number> {
    // Try to place order via Python proxy
    try {
      const response = await fetch('http://localhost:6680/order/sell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, quantity }),
      });

      const result = await response.json() as { success: boolean; orderId?: number; error?: string };

      // If proxy returned an error (including "Not connected to IB"), fail the order
      if (!response.ok || !result.success) {
        const errorMsg = result.error || `Order failed with status ${response.status}`;
        this.logger.error(`[IB PROXY] SELL order failed: ${errorMsg}`);
        throw new Error(errorMsg);
      }

      if (result.orderId) {
        this.logger.log(`[IB PROXY] SELL order placed: ${result.orderId} - ${quantity} ${symbol}`);
        return result.orderId;
      }

      throw new Error('Order placed but no orderId returned');
    } catch (proxyError) {
      const errorMessage = (proxyError as Error).message;

      // If it's an IB Gateway connection error, propagate it - don't simulate
      if (errorMessage.includes('Not connected') || errorMessage.includes('IB')) {
        this.logger.error(`[IB] Cannot place sell order - IB Gateway disconnected: ${errorMessage}`);
        throw proxyError;
      }

      // Only fall back to simulation if proxy is completely unreachable (network error)
      if (errorMessage.includes('fetch') || errorMessage.includes('ECONNREFUSED')) {
        this.logger.warn(`IB Proxy unreachable, falling back to simulation: ${errorMessage}`);
        return this.simulateSellOrder(symbol, quantity, limitPrice);
      }

      // Any other error should propagate
      throw proxyError;
    }
  }

  private async simulateSellOrder(
    symbol: string,
    quantity: number,
    limitPrice?: number,
  ): Promise<number> {
    const orderId = this.paperOrderId++;
    const fillPrice = limitPrice || (await this.getSimulatedPrice(symbol));

    this.logger.log(`[PAPER] Simulated SELL order ${orderId}: ${quantity} ${symbol} @ ${fillPrice}`);

    setTimeout(() => {
      this.eventEmitter.emit('ib.orderStatus', {
        orderId,
        status: 'Filled',
        filled: quantity,
        remaining: 0,
        avgFillPrice: fillPrice,
        isPaper: true,
      });

      this.eventEmitter.emit('ib.execution', {
        reqId: orderId,
        contract: { symbol },
        execution: {
          side: 'SELL',
          shares: quantity,
          price: fillPrice,
          orderId,
          isPaper: true,
        },
      });
    }, 100);

    return orderId;
  }

  async placeTrailingStopOrder(
    symbol: string,
    quantity: number,
    trailPercent: number,
  ): Promise<number> {
    // Note: Python proxy currently only supports fixed stop orders, not trailing stops
    // We track trailing stops in our app and manage them manually
    // For now, simulate the trailing stop tracking
    this.logger.log(`[TRAILING STOP] ${quantity} ${symbol} @ ${trailPercent}% - managed by app`);
    return this.simulateTrailingStopOrder(symbol, quantity, trailPercent);
  }

  private simulateTrailingStopOrder(
    symbol: string,
    quantity: number,
    trailPercent: number,
  ): number {
    const orderId = this.paperOrderId++;

    this.logger.log(`[PAPER] Simulated TRAIL STOP order ${orderId}: ${quantity} ${symbol} @ ${trailPercent}%`);

    // In paper mode, trailing stops are tracked but not immediately filled
    this.eventEmitter.emit('ib.orderStatus', {
      orderId,
      status: 'PreSubmitted',
      filled: 0,
      remaining: quantity,
      avgFillPrice: 0,
      isPaper: true,
      trailPercent,
    });

    return orderId;
  }

  async cancelOrder(orderId: number): Promise<void> {
    // Paper orders (ID >= 100000) don't need real cancellation
    if (orderId >= 100000) {
      this.logger.log(`[PAPER] Cancelled order ${orderId}`);
      this.eventEmitter.emit('ib.orderStatus', {
        orderId,
        status: 'Cancelled',
        filled: 0,
        remaining: 0,
        avgFillPrice: 0,
        isPaper: true,
      });
      return;
    }

    // Use proxy to cancel real orders
    try {
      const response = await fetch(`http://localhost:6680/order/cancel/${orderId}`, {
        method: 'DELETE',
      });

      const result = await response.json() as { success: boolean; error?: string };

      if (!response.ok || !result.success) {
        const errorMsg = result.error || `Cancel failed with status ${response.status}`;
        this.logger.error(`[IB PROXY] Cancel order failed: ${errorMsg}`);
        throw new Error(errorMsg);
      }

      this.logger.log(`[IB PROXY] Cancelled order ${orderId}`);
    } catch (proxyError) {
      const errorMessage = (proxyError as Error).message;

      // If it's an IB Gateway connection error, propagate it
      if (errorMessage.includes('Not connected') || errorMessage.includes('IB')) {
        this.logger.error(`[IB] Cannot cancel order - IB Gateway disconnected: ${errorMessage}`);
        throw proxyError;
      }

      // If proxy is unreachable, still throw - we can't silently fail on cancel
      this.logger.error(`[IB] Failed to cancel order ${orderId}: ${errorMessage}`);
      throw proxyError;
    }
  }

  async modifyTrailingStop(
    orderId: number,
    symbol: string,
    quantity: number,
    trailPercent: number,
  ): Promise<void> {
    // Paper orders (ID >= 100000) - just log the modification
    if (orderId >= 100000) {
      this.logger.log(`[PAPER] Modified TRAIL STOP order ${orderId}: ${trailPercent}%`);
      this.eventEmitter.emit('ib.orderStatus', {
        orderId,
        status: 'PreSubmitted',
        filled: 0,
        remaining: quantity,
        avgFillPrice: 0,
        isPaper: true,
        trailPercent,
      });
      return;
    }

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

    // Try to modify via Python proxy
    try {
      const response = await fetch(`http://localhost:6680/order/stop/${orderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, quantity: shares, stopPrice: newStopPrice }),
      });

      const result = await response.json() as { success: boolean; orderId?: number; error?: string };

      // If proxy returned an error (including "Not connected to IB"), fail
      if (!response.ok || !result.success) {
        const errorMsg = result.error || `Modify stop failed with status ${response.status}`;
        this.logger.error(`[IB PROXY] Modify STOP failed: ${errorMsg}`);
        return { success: false, reason: errorMsg };
      }

      this.logger.log(`[IB PROXY] Modified STOP ${orderId}: ${currentStopPrice} -> ${newStopPrice}`);
      return { success: true };
    } catch (proxyError) {
      const errorMessage = (proxyError as Error).message;

      // If it's an IB Gateway connection error, fail - don't simulate
      if (errorMessage.includes('Not connected') || errorMessage.includes('IB')) {
        this.logger.error(`[IB] Cannot modify stop - IB Gateway disconnected: ${errorMessage}`);
        return { success: false, reason: errorMessage };
      }

      // Only fall back to simulation if proxy is completely unreachable (network error)
      if (errorMessage.includes('fetch') || errorMessage.includes('ECONNREFUSED')) {
        this.logger.warn(`IB Proxy unreachable, simulating stop modify: ${errorMessage}`);
        this.eventEmitter.emit('ib.orderStatus', {
          orderId,
          status: 'PreSubmitted',
          filled: 0,
          remaining: shares,
          avgFillPrice: 0,
          stopPrice: newStopPrice,
        });
        return { success: true };
      }

      // Any other error should fail
      return { success: false, reason: errorMessage };
    }
  }

  isPaperMode(): boolean {
    return this.circuitBreaker.isPaperMode();
  }

  getTradingMode(): 'paper' | 'live' {
    return this.circuitBreaker.getTradingMode();
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
