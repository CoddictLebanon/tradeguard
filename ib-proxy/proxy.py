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

# === Global State ===
ib = IB()
ib_lock = threading.Lock()
ib_loop = None  # Event loop for IB thread

connection_status = {
    'connected': False,
    'account_id': None,
    'error': None,
    'last_heartbeat': None,
    'heartbeat_failures': 0,
    'heartbeat_verified': False,  # True = actively verified, False = stale/unverified
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

# === Heartbeat Function ===
def _ib_heartbeat() -> bool:
    """
    Active heartbeat check - actually pings IB to verify connection is alive.
    Returns True if IB responds, False if connection is dead/stale.
    """
    with ib_lock:
        if not ib.isConnected():
            return False
        try:
            # Request current time from IB - this is a lightweight operation
            # that will fail if the connection is stale
            server_time = ib.reqCurrentTime()
            if server_time:
                return True
            return False
        except Exception as e:
            print(f"[IB Proxy] Heartbeat failed: {e}")
            return False

# === IB Operations (run in thread pool with timeout) ===
def _ib_connect(host: str, port: int, client_id: int) -> bool:
    """Connect to IB Gateway - runs in thread pool"""
    global connection_status
    with ib_lock:
        if ib.isConnected():
            # Verify existing connection with heartbeat
            try:
                server_time = ib.reqCurrentTime()
                if server_time:
                    return True
            except:
                # Connection is stale, disconnect and reconnect
                try:
                    ib.disconnect()
                except:
                    pass

        try:
            ib.connect(host, port, clientId=client_id, timeout=5)
            if ib.isConnected():
                accounts = ib.managedAccounts()
                connection_status['connected'] = True
                connection_status['account_id'] = accounts[0] if accounts else None
                connection_status['error'] = None
                connection_status['heartbeat_failures'] = 0
                connection_status['heartbeat_verified'] = True
                connection_status['last_heartbeat'] = time.time()
                print(f"[IB Proxy] Connected - Account: {connection_status['account_id']}")
                return True
        except Exception as e:
            connection_status['error'] = str(e)
            connection_status['connected'] = False
            connection_status['heartbeat_verified'] = False
            print(f"[IB Proxy] Connection failed: {e}")
        return False

def _ib_disconnect():
    """Disconnect from IB Gateway"""
    global connection_status
    with ib_lock:
        try:
            if ib.isConnected():
                ib.disconnect()
        except:
            pass
        connection_status['connected'] = False
        connection_status['account_id'] = None
        connection_status['heartbeat_verified'] = False
        connection_status['heartbeat_failures'] = 0

def _ib_get_status() -> dict:
    """Get connection status - uses heartbeat-verified state"""
    # Use heartbeat_verified for accurate status, not ib.isConnected()
    is_connected = connection_status['connected'] and connection_status['heartbeat_verified']
    return {
        'connected': is_connected,
        'status': 'connected' if is_connected else 'disconnected',
        'tradingMode': 'paper',
        'account': connection_status['account_id'],
        'error': connection_status['error'] if not is_connected else None,
        'lastHeartbeat': connection_status['last_heartbeat'],
        'heartbeatFailures': connection_status['heartbeat_failures'],
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

# === Background Heartbeat Monitor ===
async def heartbeat_monitor():
    """
    Background task that actively monitors IB connection with heartbeats.
    Runs every 5 seconds. After 3 consecutive failures (15s), marks as disconnected.
    """
    global connection_status

    while True:
        await asyncio.sleep(HEARTBEAT_INTERVAL)

        try:
            # Run heartbeat check with timeout
            loop = asyncio.get_event_loop()
            future = loop.run_in_executor(executor, _ib_heartbeat)
            heartbeat_ok = await asyncio.wait_for(future, timeout=IB_TIMEOUT)

            if heartbeat_ok:
                # Heartbeat successful - reset failure counter
                if connection_status['heartbeat_failures'] > 0:
                    print(f"[IB Proxy] Heartbeat restored after {connection_status['heartbeat_failures']} failures")
                connection_status['heartbeat_failures'] = 0
                connection_status['heartbeat_verified'] = True
                connection_status['last_heartbeat'] = time.time()
                connection_status['connected'] = True
                connection_status['error'] = None
            else:
                # Heartbeat failed
                connection_status['heartbeat_failures'] += 1
                print(f"[IB Proxy] Heartbeat failed ({connection_status['heartbeat_failures']}/{HEARTBEAT_MAX_FAILURES})")

                if connection_status['heartbeat_failures'] >= HEARTBEAT_MAX_FAILURES:
                    # Mark as disconnected after 3 consecutive failures
                    if connection_status['heartbeat_verified']:  # Only log once
                        print(f"[IB Proxy] Connection dead - {HEARTBEAT_MAX_FAILURES} consecutive heartbeat failures")
                    connection_status['heartbeat_verified'] = False
                    connection_status['connected'] = False
                    connection_status['error'] = f"Heartbeat failed {HEARTBEAT_MAX_FAILURES} times"

                    # Try to reconnect
                    try:
                        print("[IB Proxy] Attempting to reconnect...")
                        await run_with_timeout(_ib_connect, '127.0.0.1', IB_PORT, 10, timeout=10)
                    except Exception as e:
                        print(f"[IB Proxy] Reconnect failed: {e}")

        except asyncio.TimeoutError:
            # Heartbeat timed out - treat as failure
            connection_status['heartbeat_failures'] += 1
            print(f"[IB Proxy] Heartbeat timed out ({connection_status['heartbeat_failures']}/{HEARTBEAT_MAX_FAILURES})")

            if connection_status['heartbeat_failures'] >= HEARTBEAT_MAX_FAILURES:
                if connection_status['heartbeat_verified']:
                    print(f"[IB Proxy] Connection dead - heartbeat timeouts")
                connection_status['heartbeat_verified'] = False
                connection_status['connected'] = False
                connection_status['error'] = "Heartbeat timeout"

        except Exception as e:
            print(f"[IB Proxy] Heartbeat monitor error: {e}")

# === FastAPI App ===
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events"""
    print(f"[IB Proxy] Starting on port {PROXY_PORT}...")
    print(f"[IB Proxy] Endpoints: /status, /account, /positions, /orders")
    print(f"[IB Proxy] Heartbeat: every {HEARTBEAT_INTERVAL}s, disconnect after {HEARTBEAT_MAX_FAILURES} failures")

    # Try initial connection
    try:
        await run_with_timeout(_ib_connect, '127.0.0.1', IB_PORT, 10, timeout=10)
    except Exception as e:
        print(f"[IB Proxy] Initial connection failed: {e}")

    # Start heartbeat monitor
    monitor_task = asyncio.create_task(heartbeat_monitor())
    print("[IB Proxy] Heartbeat monitor started")

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
    """Health check - returns proxy health and IB connection status"""
    return {
        'status': 'ok',
        'ib_connected': connection_status['connected'] and connection_status['heartbeat_verified'],
        'heartbeat_failures': connection_status['heartbeat_failures'],
    }

@app.get("/status")
async def status():
    """Get connection status - uses heartbeat-verified state"""
    return _ib_get_status()

@app.post("/connect")
async def connect(req: ConnectRequest, _: bool = Depends(verify_api_key)):
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
async def disconnect(_: bool = Depends(verify_api_key)):
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

if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=PROXY_PORT, log_level='warning')
