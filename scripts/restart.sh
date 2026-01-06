#!/bin/bash
# TradeGuard restart script - kills orphan processes and restarts cleanly

echo "Stopping all PM2 processes..."
pm2 stop all 2>/dev/null

echo "Killing any orphan processes on ports 3666, 3667, 6680..."
sudo fuser -k 3666/tcp 2>/dev/null
sudo fuser -k 3667/tcp 2>/dev/null
sudo fuser -k 6680/tcp 2>/dev/null

# Also kill any orphan next-server or node processes related to tradeguard
sudo pkill -9 -f "next-server.*3666" 2>/dev/null
sudo pkill -9 -f "proxy.py" 2>/dev/null

sleep 2

echo "Verifying ports are free..."
if sudo lsof -i :3666 -t 2>/dev/null; then
    echo "WARNING: Port 3666 still in use, force killing..."
    sudo kill -9 $(sudo lsof -i :3666 -t) 2>/dev/null
fi
if sudo lsof -i :3667 -t 2>/dev/null; then
    echo "WARNING: Port 3667 still in use, force killing..."
    sudo kill -9 $(sudo lsof -i :3667 -t) 2>/dev/null
fi

sleep 1

echo "Starting all services..."
cd /home/xcoder/Desktop/Claude/TradeGuard
pm2 start ecosystem.config.js

sleep 5

echo ""
echo "Status:"
pm2 status

# Quick health check
echo ""
echo "Health checks:"
curl -s -o /dev/null -w "Web (3666): %{http_code}\n" http://localhost:3666/ 2>/dev/null || echo "Web (3666): FAILED"
curl -s -o /dev/null -w "API (3667): %{http_code}\n" http://localhost:3667/ 2>/dev/null || echo "API (3667): FAILED"
curl -s -o /dev/null -w "IB Proxy (6680): %{http_code}\n" http://localhost:6680/health 2>/dev/null || echo "IB Proxy (6680): FAILED"
