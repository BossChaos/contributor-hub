#!/bin/bash
# check_sync.sh — Monitor Midnight node sync progress
# Usage: chmod +x check_sync.sh && watch -n 10 ./check_sync.sh

RPC="http://localhost:9944"

BLOCK=$(curl -s -H "Content-Type: application/json" \
  -d '{"id":1,"jsonrpc":"2.0","method":"chain_getHeader","params":[]}' \
  "$RPC" 2>/dev/null | python3 -c "
import json, sys
d = json.load(sys.stdin)
if d.get('result'):
    print(int(d['result']['number'], 16))
else:
    print('N/A')
" 2>/dev/null)

if [ "$BLOCK" != "N/A" ] && [ -n "$BLOCK" ]; then
    echo "$(date '+%H:%M:%S') — Block #$BLOCK"
else
    echo "$(date '+%H:%M:%S') — Node not responding yet"
fi
