#!/bin/bash

pnpm build || exit 1

# Start server directly
cd packages/server
npx tsx src/index.ts &
SERVER_PID=$!
cd ../..

trap "kill $SERVER_PID 2>/dev/null; exit" INT TERM EXIT

# Wait for server to be ready
echo "Waiting for server..."
for i in {1..10}; do
  if curl -s http://localhost:3000 > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo ""
echo "🎮 Game available at https://play.dealmein.uk"
echo ""

# Start Cloudflare Tunnel
cloudflared tunnel run cardgames
