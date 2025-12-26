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
