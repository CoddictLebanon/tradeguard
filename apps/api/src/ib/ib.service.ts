import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IBApi, EventName, Contract, Order, OrderAction, OrderType, SecType } from '@stoqey/ib';
import {
  IBConfig,
  IBAccountSummary,
  IBPosition,
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
