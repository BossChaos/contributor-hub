#!/bin/bash
# health_check.sh — Comprehensive Midnight node health verification
set -euo pipefail

RPC="http://localhost:9944"

# Check if node is responding
RESPONSE=$(curl -s -H "Content-Type: application/json" \
  -d '{"id":1,"jsonrpc":"2.0","method":"system_health","params":[]}' \
  "$RPC" 2>/dev/null)

if [ -z "$RESPONSE" ]; then
    echo "❌ Node RPC is not responding. Is the container running?"
    docker ps --filter name=midnight-node --format '{{.Status}}' 2>/dev/null || echo "(docker not available)"
    exit 1
fi

PEERS=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['peers'])")
IS_SYNCING=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['isSyncing'])")
SHOULD_HAVE_PEERS=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['shouldHavePeers'])")

BLOCK=$(curl -s -H "Content-Type: application/json" \
  -d '{"id":1,"jsonrpc":"2.0","method":"chain_getHeader","params":[]}' \
  "$RPC" | python3 -c "import json,sys; print(int(json.load(sys.stdin)['result']['number'], 16))")

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Midnight Node Health Report"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Block height:     #$BLOCK"
echo "  Connected peers:  $PEERS"
echo "  Syncing:          $IS_SYNCING"
echo "  Should have peers: $SHOULD_HAVE_PEERS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$IS_SYNCING" = "False" ] && [ "$PEERS" -gt 0 ]; then
    echo "  ✅ Node is fully synced and healthy"
elif [ "$IS_SYNCING" = "True" ]; then
    echo "  ⏳ Node is still syncing. Check back later."
else
    echo "  ⚠️  Node reports not syncing but has no peers"
    echo "     This may indicate a network connectivity issue."
fi

if [ "$PEERS" -lt 3 ]; then
    echo "  ⚠️  Warning: low peer count ($PEERS). Check firewall."
fi
