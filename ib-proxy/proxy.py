#!/usr/bin/env python3
"""
IB Proxy - A reliable async service that bridges the trading app with Interactive Brokers.
Uses FastAPI for async HTTP handling and ThreadPoolExecutor for IB operations with timeouts.
"""

import os
import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import uvicorn

# Suppress ib_insync logging noise
import logging
logging.getLogger('ib_insync').setLevel(logging.WARNING)

from ib_insync import IB, Stock, MarketOrder, StopOrder

# === Configuration ===
IB_TIMEOUT = 5  # seconds - max time to wait for any IB operation
IB_PORT = 4002
PROXY_PORT = int(os.environ.get('IB_PROXY_PORT', 6680))

# === Global State ===
ib = IB()
ib_lock = threading.Lock()
ib_loop = None  # Event loop for IB thread

connection_status = {
    'connected': False,
    'account_id': None,
    'error': None,
}

def _init_ib_thread():
    """Initialize event loop for IB thread"""
    global ib_loop
    ib_loop = asyncio.new_event_loop()
    asyncio.set_event_loop(ib_loop)

executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ib_worker", initializer=_init_ib_thread)

# === Pydantic Models ===
class BuyOrderRequest(BaseModel):
    symbol: str
    quantity: int

class SellOrderRequest(BaseModel):
    symbol: str
    quantity: int

class StopOrderRequest(BaseModel):
    symbol: str
    quantity: int
    stopPrice: float

class ConnectRequest(BaseModel):
    host: str = '127.0.0.1'
    port: int = 4002
    clientId: int = 10

# === IB Operations (run in thread pool with timeout) ===
def _ib_connect(host: str, port: int, client_id: int) -> bool:
    """Connect to IB Gateway - runs in thread pool"""
    with ib_lock:
        if ib.isConnected():
            return True
        try:
            ib.connect(host, port, clientId=client_id, timeout=5)
            if ib.isConnected():
                accounts = ib.managedAccounts()
                connection_status['connected'] = True
                connection_status['account_id'] = accounts[0] if accounts else None
                connection_status['error'] = None
                print(f"[IB Proxy] Connected - Account: {connection_status['account_id']}")
                return True
        except Exception as e:
            connection_status['error'] = str(e)
            print(f"[IB Proxy] Connection failed: {e}")
        return False

def _ib_disconnect():
    """Disconnect from IB Gateway"""
    with ib_lock:
        try:
            if ib.isConnected():
                ib.disconnect()
        except:
            pass
        connection_status['connected'] = False
        connection_status['account_id'] = None

def _ib_is_connected() -> bool:
    """Check if connected - fast, no lock needed for read"""
    return ib.isConnected()

def _ib_get_status() -> dict:
    """Get connection status"""
    is_connected = ib.isConnected()
    return {
        'connected': is_connected,
        'status': 'connected' if is_connected else 'disconnected',
        'tradingMode': 'paper',
        'account': connection_status['account_id'],
        'error': connection_status['error'] if not is_connected else None
    }

def _ib_place_buy_order(symbol: str, quantity: int) -> dict:
    """Place buy order - runs in thread pool"""
    with ib_lock:
        if not ib.isConnected():
            raise Exception("Not connected to IB")

        contract = Stock(symbol.upper(), 'SMART', 'USD')
        ib.qualifyContracts(contract)

        order = MarketOrder('BUY', quantity)
        order.outsideRth = True
        trade = ib.placeOrder(contract, order)
        ib.sleep(1)  # Brief wait for order submission

        print(f"[IB Proxy] BUY {quantity} {symbol} - Order ID: {trade.order.orderId}")
        return {
            'success': True,
            'orderId': trade.order.orderId,
            'status': trade.orderStatus.status,
            'filled': trade.orderStatus.filled,
            'avgFillPrice': trade.orderStatus.avgFillPrice
        }

def _ib_place_sell_order(symbol: str, quantity: int) -> dict:
    """Place sell order - runs in thread pool"""
    with ib_lock:
        if not ib.isConnected():
            raise Exception("Not connected to IB")

        contract = Stock(symbol.upper(), 'SMART', 'USD')
        ib.qualifyContracts(contract)

        order = MarketOrder('SELL', quantity)
        order.outsideRth = True
        trade = ib.placeOrder(contract, order)
        ib.sleep(1)

        print(f"[IB Proxy] SELL {quantity} {symbol} - Order ID: {trade.order.orderId}")
        return {
            'success': True,
            'orderId': trade.order.orderId,
            'status': trade.orderStatus.status
        }

def _ib_place_stop_order(symbol: str, quantity: int, stop_price: float) -> dict:
    """Place stop order - runs in thread pool"""
    with ib_lock:
        if not ib.isConnected():
            raise Exception("Not connected to IB")

        contract = Stock(symbol.upper(), 'SMART', 'USD')
        ib.qualifyContracts(contract)

        order = StopOrder('SELL', quantity, stop_price)
        order.outsideRth = True
        order.tif = 'GTC'
        trade = ib.placeOrder(contract, order)
        ib.sleep(1)

        print(f"[IB Proxy] STOP {quantity} {symbol} @ ${stop_price} - Order ID: {trade.order.orderId}")
        return {
            'success': True,
            'orderId': trade.order.orderId,
            'status': trade.orderStatus.status
        }

def _ib_modify_stop_order(order_id: int, symbol: str, quantity: int, stop_price: float) -> dict:
    """Modify stop order - runs in thread pool"""
    with ib_lock:
        if not ib.isConnected():
            raise Exception("Not connected to IB")

        contract = Stock(symbol.upper(), 'SMART', 'USD')
        ib.qualifyContracts(contract)

        order = StopOrder('SELL', quantity, stop_price)
        order.orderId = order_id
        order.outsideRth = True
        order.tif = 'GTC'
        trade = ib.placeOrder(contract, order)
        ib.sleep(1)

        print(f"[IB Proxy] MODIFIED STOP {order_id}: {symbol} @ ${stop_price}")
        return {
            'success': True,
            'orderId': trade.order.orderId,
            'status': trade.orderStatus.status
        }

def _ib_cancel_order(order_id: int) -> dict:
    """Cancel order - runs in thread pool"""
    with ib_lock:
        if not ib.isConnected():
            raise Exception("Not connected to IB")

        for trade in ib.openTrades():
            if trade.order.orderId == order_id:
                ib.cancelOrder(trade.order)
                print(f"[IB Proxy] Cancelled order {order_id}")
                return {'success': True}

        raise Exception("Order not found")

def _ib_get_positions() -> list:
    """Get positions - runs in thread pool"""
    with ib_lock:
        if not ib.isConnected():
            raise Exception("Not connected to IB")

        positions = ib.positions()
        return [
            {
                'symbol': pos.contract.symbol,
                'position': float(pos.position),
                'avgCost': float(pos.avgCost),
                'account': pos.account
            }
            for pos in positions if pos.position != 0
        ]

def _ib_get_orders() -> list:
    """Get open orders - runs in thread pool"""
    with ib_lock:
        if not ib.isConnected():
            raise Exception("Not connected to IB")

        trades = ib.openTrades()
        return [
            {
                'orderId': trade.order.orderId,
                'symbol': trade.contract.symbol,
                'action': trade.order.action,
                'quantity': float(trade.order.totalQuantity),
                'orderType': trade.order.orderType,
                'status': trade.orderStatus.status
            }
            for trade in trades
        ]

def _ib_get_account() -> dict:
    """Get account summary - runs in thread pool"""
    with ib_lock:
        if not ib.isConnected():
            raise Exception("Not connected to IB")

        account_values = ib.accountSummary()
        summary = {'accountId': connection_status['account_id']}

        for av in account_values:
            if av.tag == 'NetLiquidation':
                summary['netLiquidation'] = float(av.value)
            elif av.tag == 'AvailableFunds':
                summary['availableFunds'] = float(av.value)
            elif av.tag == 'BuyingPower':
                summary['buyingPower'] = float(av.value)
            elif av.tag == 'TotalCashValue':
                summary['totalCashValue'] = float(av.value)

        return summary

# === Async wrapper with timeout ===
async def run_with_timeout(func, *args, timeout: float = IB_TIMEOUT):
    """Run a blocking function in thread pool with timeout"""
    loop = asyncio.get_event_loop()
    try:
        future = loop.run_in_executor(executor, func, *args)
        return await asyncio.wait_for(future, timeout=timeout)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail=f"IB operation timed out after {timeout}s")
    except Exception as e:
        error_msg = str(e)
        if "Not connected" in error_msg:
            raise HTTPException(status_code=503, detail=error_msg)
        raise HTTPException(status_code=500, detail=error_msg)

# === Background connection monitor ===
async def connection_monitor():
    """Background task that monitors and auto-reconnects"""
    while True:
        await asyncio.sleep(5)
        try:
            if not ib.isConnected():
                print("[IB Proxy] Attempting to reconnect...")
                await run_with_timeout(_ib_connect, '127.0.0.1', IB_PORT, 10, timeout=10)
        except Exception as e:
            print(f"[IB Proxy] Reconnect failed: {e}")

# === FastAPI App ===
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events"""
    print(f"[IB Proxy] Starting on port {PROXY_PORT}...")
    print(f"[IB Proxy] Endpoints: /status, /account, /positions, /orders")

    # Try initial connection
    try:
        await run_with_timeout(_ib_connect, '127.0.0.1', IB_PORT, 10, timeout=10)
    except Exception as e:
        print(f"[IB Proxy] Initial connection failed: {e}")

    # Start background monitor
    monitor_task = asyncio.create_task(connection_monitor())
    print("[IB Proxy] Connection monitor started (auto-reconnect every 5s)")

    yield

    # Shutdown
    monitor_task.cancel()
    _ib_disconnect()
    executor.shutdown(wait=False)
    print("[IB Proxy] Shutdown complete")

app = FastAPI(title="IB Proxy", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# === Endpoints ===
@app.get("/health")
async def health():
    """Health check - returns immediately, never blocks"""
    return {'status': 'ok', 'ib_connected': _ib_is_connected()}

@app.get("/status")
async def status():
    """Get connection status - returns immediately"""
    return _ib_get_status()

@app.post("/connect")
async def connect(req: ConnectRequest):
    """Connect to IB Gateway"""
    try:
        success = await run_with_timeout(_ib_connect, req.host, req.port, req.clientId, timeout=10)
        if success:
            return {'success': True, 'account': connection_status['account_id']}
        return {'success': False, 'error': connection_status['error']}
    except HTTPException:
        raise
    except Exception as e:
        return {'success': False, 'error': str(e)}

@app.post("/disconnect")
async def disconnect():
    """Disconnect from IB Gateway"""
    _ib_disconnect()
    return {'success': True}

@app.get("/account")
async def get_account():
    """Get account summary"""
    return await run_with_timeout(_ib_get_account)

@app.get("/positions")
async def get_positions():
    """Get current positions"""
    return await run_with_timeout(_ib_get_positions)

@app.get("/orders")
async def get_orders():
    """Get open orders"""
    return await run_with_timeout(_ib_get_orders)

@app.post("/order/buy")
async def place_buy_order(req: BuyOrderRequest):
    """Place a market buy order"""
    return await run_with_timeout(_ib_place_buy_order, req.symbol, req.quantity)

@app.post("/order/sell")
async def place_sell_order(req: SellOrderRequest):
    """Place a market sell order"""
    return await run_with_timeout(_ib_place_sell_order, req.symbol, req.quantity)

@app.post("/order/stop")
async def place_stop_order(req: StopOrderRequest):
    """Place a stop loss order"""
    return await run_with_timeout(_ib_place_stop_order, req.symbol, req.quantity, req.stopPrice)

@app.put("/order/stop/{order_id}")
async def modify_stop_order(order_id: int, req: StopOrderRequest):
    """Modify an existing stop order"""
    return await run_with_timeout(_ib_modify_stop_order, order_id, req.symbol, req.quantity, req.stopPrice)

@app.delete("/order/cancel/{order_id}")
async def cancel_order(order_id: int):
    """Cancel an order"""
    return await run_with_timeout(_ib_cancel_order, order_id)

if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=PROXY_PORT, log_level='warning')
