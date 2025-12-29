#!/usr/bin/env python3
"""
IB Proxy - A standalone service that bridges the trading app with Interactive Brokers.
Runs independently so IB connection issues don't affect the main app.
"""

import os
import asyncio
import nest_asyncio
from flask import Flask, jsonify, request
from flask_cors import CORS
from ib_insync import IB, Stock, MarketOrder, StopOrder

# Allow nested event loops (needed for Flask + asyncio)
nest_asyncio.apply()

# Suppress ib_insync logging noise
import logging
logging.getLogger('ib_insync').setLevel(logging.WARNING)

app = Flask(__name__)
CORS(app)

# Global IB connection
ib = IB()
connection_status = {
    'connected': False,
    'status': 'disconnected',
    'error': None,
    'account_id': None
}

def run_async(coro):
    """Run async code in sync context"""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'ok', 'ib_connected': ib.isConnected()})

@app.route('/status', methods=['GET'])
def status():
    """Get IB connection status"""
    return jsonify({
        'connected': ib.isConnected(),
        'status': 'connected' if ib.isConnected() else 'disconnected',
        'tradingMode': 'paper',
        'account': connection_status['account_id'],
        'error': connection_status['error']
    })

@app.route('/connect', methods=['POST'])
def connect():
    """Connect to TWS"""
    try:
        if ib.isConnected():
            return jsonify({'success': True, 'message': 'Already connected'})

        data = request.json or {}
        host = data.get('host', '127.0.0.1')
        port = data.get('port', 7497)
        client_id = data.get('clientId', 10)

        connection_status['status'] = 'connecting'
        ib.connect(host, port, clientId=client_id, timeout=10)

        connection_status['connected'] = True
        connection_status['status'] = 'connected'
        connection_status['error'] = None

        # Get account ID
        accounts = ib.managedAccounts()
        if accounts:
            connection_status['account_id'] = accounts[0]

        print(f"[IB Proxy] Connected to TWS on port {port}, account: {connection_status['account_id']}")
        return jsonify({'success': True, 'account': connection_status['account_id']})

    except Exception as e:
        connection_status['status'] = 'error'
        connection_status['error'] = str(e)
        print(f"[IB Proxy] Connection error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 503

@app.route('/disconnect', methods=['POST'])
def disconnect():
    """Disconnect from TWS"""
    try:
        if ib.isConnected():
            ib.disconnect()
        connection_status['connected'] = False
        connection_status['status'] = 'disconnected'
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/account', methods=['GET'])
def get_account():
    """Get account summary"""
    if not ib.isConnected():
        return jsonify({'error': 'Not connected to IB'}), 503

    try:
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

        return jsonify(summary)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/positions', methods=['GET'])
def get_positions():
    """Get current positions from IB"""
    if not ib.isConnected():
        return jsonify({'error': 'Not connected to IB'}), 503

    try:
        positions = ib.positions()
        result = []
        for pos in positions:
            if pos.position != 0:
                result.append({
                    'symbol': pos.contract.symbol,
                    'position': float(pos.position),
                    'avgCost': float(pos.avgCost),
                    'account': pos.account
                })
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/order/buy', methods=['POST'])
def place_buy_order():
    """Place a market buy order"""
    if not ib.isConnected():
        return jsonify({'error': 'Not connected to IB'}), 503

    try:
        data = request.json
        symbol = data['symbol'].upper()
        quantity = int(data['quantity'])

        contract = Stock(symbol, 'SMART', 'USD')
        ib.qualifyContracts(contract)

        order = MarketOrder('BUY', quantity)
        trade = ib.placeOrder(contract, order)
        ib.sleep(1)

        print(f"[IB Proxy] BUY {quantity} {symbol} - Order ID: {trade.order.orderId}")

        return jsonify({
            'success': True,
            'orderId': trade.order.orderId,
            'status': trade.orderStatus.status
        })
    except Exception as e:
        print(f"[IB Proxy] Buy order error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/order/stop', methods=['POST'])
def place_stop_order():
    """Place a stop loss order"""
    if not ib.isConnected():
        return jsonify({'error': 'Not connected to IB'}), 503

    try:
        data = request.json
        symbol = data['symbol'].upper()
        quantity = int(data['quantity'])
        stop_price = float(data['stopPrice'])

        contract = Stock(symbol, 'SMART', 'USD')
        ib.qualifyContracts(contract)

        order = StopOrder('SELL', quantity, stop_price)
        trade = ib.placeOrder(contract, order)
        ib.sleep(1)

        print(f"[IB Proxy] STOP {quantity} {symbol} @ ${stop_price} - Order ID: {trade.order.orderId}")

        return jsonify({
            'success': True,
            'orderId': trade.order.orderId,
            'status': trade.orderStatus.status
        })
    except Exception as e:
        print(f"[IB Proxy] Stop order error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/order/sell', methods=['POST'])
def place_sell_order():
    """Place a market sell order"""
    if not ib.isConnected():
        return jsonify({'error': 'Not connected to IB'}), 503

    try:
        data = request.json
        symbol = data['symbol'].upper()
        quantity = int(data['quantity'])

        contract = Stock(symbol, 'SMART', 'USD')
        ib.qualifyContracts(contract)

        order = MarketOrder('SELL', quantity)
        trade = ib.placeOrder(contract, order)
        ib.sleep(1)

        print(f"[IB Proxy] SELL {quantity} {symbol} - Order ID: {trade.order.orderId}")

        return jsonify({
            'success': True,
            'orderId': trade.order.orderId,
            'status': trade.orderStatus.status
        })
    except Exception as e:
        print(f"[IB Proxy] Sell order error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/order/cancel/<int:order_id>', methods=['DELETE'])
def cancel_order(order_id):
    """Cancel an order by ID"""
    if not ib.isConnected():
        return jsonify({'error': 'Not connected to IB'}), 503

    try:
        for trade in ib.openTrades():
            if trade.order.orderId == order_id:
                ib.cancelOrder(trade.order)
                print(f"[IB Proxy] Cancelled order {order_id}")
                return jsonify({'success': True})

        return jsonify({'success': False, 'error': 'Order not found'}), 404
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/orders', methods=['GET'])
def get_orders():
    """Get all open orders"""
    if not ib.isConnected():
        return jsonify({'error': 'Not connected to IB'}), 503

    try:
        trades = ib.openTrades()
        result = []
        for trade in trades:
            result.append({
                'orderId': trade.order.orderId,
                'symbol': trade.contract.symbol,
                'action': trade.order.action,
                'quantity': float(trade.order.totalQuantity),
                'orderType': trade.order.orderType,
                'status': trade.orderStatus.status
            })
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get('IB_PROXY_PORT', 6680))
    print(f"[IB Proxy] Starting on port {port}...")
    print(f"[IB Proxy] POST /connect to connect to TWS")
    print(f"[IB Proxy] Endpoints: /status, /account, /positions, /orders")
    print(f"[IB Proxy] Order endpoints: /order/buy, /order/sell, /order/stop")

    # Use threaded=False to avoid async issues
    app.run(host='0.0.0.0', port=port, threaded=False)
