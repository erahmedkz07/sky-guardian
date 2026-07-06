#!/bin/bash
# Sky Guardian — Start both servers in development mode

echo "🛡  Starting Sky Guardian Development Environment"
echo ""

# Start API server
echo "→ Starting API server (port 3001)..."
cd "$(dirname "$0")/server"
npm run dev &
API_PID=$!

# Wait for API to boot
sleep 2

# Start frontend
echo "→ Starting Frontend (port 5173)..."
cd "$(dirname "$0")"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "✅ Both servers running:"
echo "   Frontend:  http://localhost:5173"
echo "   API:       http://localhost:3001/api/health"
echo "   DB Studio: cd server && npm run db:studio"
echo ""
echo "Press Ctrl+C to stop all servers."

# Wait and cleanup
trap "kill $API_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
