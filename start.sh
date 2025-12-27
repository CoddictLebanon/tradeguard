#!/bin/bash

echo "🚀 Starting TradeGuard..."

# Check if PostgreSQL is running
if ! pg_isready -q 2>/dev/null; then
    echo "⚠️  PostgreSQL is not running. Starting it..."
    brew services start postgresql@14 || brew services start postgresql
    sleep 2
fi

# Start the API in the background
echo "📡 Starting API server (port 3000)..."
cd apps/api
npm run dev &
API_PID=$!
cd ../..

# Wait for API to be ready
echo "⏳ Waiting for API to start..."
sleep 5

# Start the web app
echo "🌐 Starting Web dashboard (port 3001)..."
cd apps/web
npm run dev &
WEB_PID=$!
cd ../..

echo ""
echo "✅ TradeGuard is running!"
echo ""
echo "   API:       http://localhost:3000"
echo "   Dashboard: http://localhost:3001"
echo ""
echo "⚠️  Before first login, create an admin user:"
echo "   curl -X POST http://localhost:3000/auth/setup \\"
echo "     -H 'Content-Type: application/json' \\"
echo '     -d '"'"'{"email": "admin@tradeguard.local", "password": "YourSecurePassword123!"}'"'"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Wait for both processes
wait $API_PID $WEB_PID
