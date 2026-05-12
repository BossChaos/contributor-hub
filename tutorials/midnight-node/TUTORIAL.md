# Running a Midnight Node: Setup, Sync & Monitoring

A full node is the backbone of your Midnight experience. Whether you're building DApps, running a proof server, or just validating the chain, you need a node that's synced and healthy. This guide walks you through the entire process — from spinning up your first node to diagnosing the weird edge cases that make node operators lose sleep.

## What a Midnight Node Actually Does

Midnight is a privacy-first blockchain built as a Cardano partner chain. A full node:

- **Syncs the blockchain** from genesis to the current block
- **Validates** every block and transaction using zero-knowledge proofs
- **Joins the P2P network** to relay transactions and blocks to other nodes
- **Exposes an RPC interface** for wallets, proof servers, and DApps

You **do not** need a proof server to run a full node. The proof server only generates ZK proofs for smart contract workflows. A node alone handles chain sync, validation, and P2P networking.

## Prerequisites & Hardware Sizing

I'll give you the honest numbers here — not the marketing minimums.

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 4 cores (x86_64 or ARM64) | 8+ cores |
| RAM | 8 GB | 16 GB |
| Storage | 150 GB SSD | 500 GB NVMe SSD |
| Network | 10 Mbps stable | 100 Mbps symmetric |
| OS | Ubuntu 22.04 / 24.04 LTS | Same |

**Critical things that trip people up:**

**SSD is non-negotiable.** The sync process does heavy random I/O on the database. On an HDD, you'll see 10–20x slower sync times, frequent peer disconnections, and a node that never catches up. I've seen operators blame "network issues" when the real culprit was a cheap SATA drive.

**RAM depends on your use case.** 8 GB is fine for block validation only. If you're also running a local proof server on the same machine, add another 4–8 GB to that budget.

**Don't use `latest` image tags.** Midnight releases new network versions regularly. Pin your image to the version matching your target network. Pulling `latest` on a production node is how you end up with a node that starts but refuses to sync because the chain spec changed.

## Step 1: Install Docker and Dependencies

Midnight ships as a Docker image. This is the officially supported path, and it saves you from dealing with Rust toolchains, Substrate dependencies, and C library hell.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg jq lsb-release netcat-openbsd openssl

# Docker Engine (official install script)
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker $USER
newgrp docker
```

Verify it works:

```bash
docker --version
docker compose version
```

## Step 2: Configure the Network

Midnight operates multiple networks. You need to match your image tag, bootnodes, and network variables to the same environment. Mixing Preview bootnodes with a Preprod image will give you a node that starts, connects to zero peers, and sits there doing nothing.

| Environment | Use Case | Node Image Tag |
|-------------|----------|----------------|
| Preview | Development & early testing | `midnightntwrk/midnight-node:0.22.5` |
| Preprod | Final pre-mainnet testing | `midnightntwrk/midnight-node:0.22.2` |
| Mainnet | Production | `midnightntwrk/midnight-node:0.22.1` |

Create your environment file. Here's the Preview setup:

```bash
mkdir -p ~/midnight-node && cd ~/midnight-node

cat > midnight.env <<'EOF'
MIDNIGHT_NETWORK=preview
MIDNIGHT_NODE_VERSION=0.22.5
MIDNIGHT_NODE_IMAGE=midnightntwrk/midnight-node:0.22.5
CARDANO_NETWORK=preview
MIDNIGHT_BOOTNODE_1=/dns/bootnode-1.preview.midnight.network/tcp/30333/ws/p2p/12D3KooWK66i7dtGVNSwDh9tTeqov1q6LSdWsRLJvTyzTCaywYgK
MIDNIGHT_BOOTNODE_2=/dns/bootnode-2.preview.midnight.network/tcp/30333/ws/p2p/12D3KooWHqFfXFwb7WW4jwR8pr4BEf562v5M6c8K3CXAJq4Wx6ym
EOF
```

If you're running on Preprod or Mainnet, swap the network names and image tags accordingly. The bootnode addresses also change per network.

## Step 3: Start the Node

### Option A: Docker Compose (Recommended)

Create a `docker-compose.yml` in your `~/midnight-node` directory:

```yaml
version: '3.8'

services:
  midnight-node:
    image: ${MIDNIGHT_NODE_IMAGE}
    container_name: midnight-node
    restart: unless-stopped
    platform: linux/amd64
    ports:
      - "30333:30333"     # P2P
      - "127.0.0.1:9944:9944"  # RPC WebSocket (localhost only)
    volumes:
      - midnight-node-data:/data
    environment:
      - RUST_LOG=info
    command: |
      --base-path /data
      --chain ${MIDNIGHT_NETWORK}
      --port 30333
      --ws-port 9944
      --name "my-midnight-node"

volumes:
  midnight-node-data:
```

Pull and start:

```bash
docker pull ${MIDNIGHT_NODE_IMAGE}
docker compose --env-file midnight.env up -d
```

### Option B: Direct Docker Run

If you prefer a single command:

```bash
docker volume create midnight-node-data

docker run -d \
  --name midnight-node \
  --restart unless-stopped \
  -p 30333:30333 \
  -p 127.0.0.1:9944:9944 \
  -v midnight-node-data:/data \
  -e RUST_LOG=info \
  midnightntwrk/midnight-node:0.22.5 \
  --base-path /data \
  --chain preview \
  --port 30333 \
  --ws-port 9944 \
  --name "my-midnight-node"
```

### Verify the Container Started

```bash
docker ps --filter name=midnight-node
```

You should see the container with status `Up`. If it exited immediately, check logs:

```bash
docker logs midnight-node --tail 50
```

Common startup failures:

- **"chain spec not found"** — wrong `--chain` value. Use `preview`, `preprod`, or the correct name for your network.
- **"address already in use"** — port 30333 or 9944 is taken. Check with `ss -tlnp | grep -E '30333|9944'`.
- **"platform mismatch"** — on ARM64 machines, add `--platform linux/amd64` to the run command.

## Step 4: Watch the Sync Process

This is where most operators get anxious. Your node will go through three distinct phases, and each one looks different in the logs.

### Phase 1: Peer Discovery (Seconds to Minutes)

When you first start, the node reaches out to the bootnodes and discovers peers:

```
INFO discovery 🔍 Discovering peers...
INFO sync 🔄 Connecting to peers...
INFO sync 🟡 Idle (0 peers)
INFO sync 🟢 Connected to 3 peers
```

If you see `Idle (0 peers)` for more than 5 minutes, you have a connectivity issue. Jump to the troubleshooting section below.

### Phase 2: Header Sync (Minutes to Hours)

Once connected, the node downloads block headers first. This is the fast part:

```
INFO sync ⚙️ Syncing 847.3 bps, target=#2458912
```

You'll see high block-per-second rates here — often 500–1000 bps. This is normal. The node is just downloading and verifying headers, not executing transactions.

### Phase 3: Block Execution (Hours)

After headers, the node downloads and executes every block from genesis. This is where the rate drops dramatically:

```
INFO sync ⚙️ Syncing 12.1 bps, target=#2458912
INFO sync Applied block #148234
```

Don't panic at the slowdown. Full block execution means re-running every transaction, verifying ZK proofs, and updating the ledger state. 5–50 bps is typical. On NVMe storage you're looking at 30–60 minutes for a full Preview sync. On SATA SSD, plan for 2–4 hours.

### Monitor Block Height

Poll the node's current block via RPC:

```bash
curl -s -H "Content-Type: application/json" \
  -d '{"id":1,"jsonrpc":"2.0","method":"chain_getHeader","params":[]}' \
  http://localhost:9944 | python3 -c "
import json, sys
d = json.load(sys.stdin)
if d.get('result'):
    print(f'Block: {int(d[\"result\"][\"number\"], 16)}')
else:
    print('No result — node may still be starting')
"
```

For continuous monitoring, save this as `check_sync.sh` and run it with `watch`:

```bash
#!/bin/bash
# check_sync.sh — Monitor Midnight node sync progress
RPC="http://localhost:9944"
BLOCK=$(curl -s -H "Content-Type: application/json" \
  -d '{"id":1,"jsonrpc":"2.0","method":"chain_getHeader","params":[]}' \
  $RPC 2>/dev/null | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(int(d['result']['number'], 16))" 2>/dev/null)

if [ -n "$BLOCK" ]; then
    echo "$(date '+%H:%M:%S') — Block #$BLOCK"
else
    echo "$(date '+%H:%M:%S') — Node not responding yet"
fi
```

```bash
chmod +x check_sync.sh
watch -n 10 ./check_sync.sh
```

## Step 5: Verify Your Node Is Synced and Healthy

A node is fully synced when it transitions from "Syncing" to "Idle" with peers connected:

```
INFO sync 💤 Idle (12 peers)
```

The 💤 emoji means the node is caught up and waiting for new blocks.

### Health Check Script

Save this as `health_check.sh` — it checks peer count, sync status, and block height in one shot:

```bash
#!/bin/bash
# health_check.sh — Comprehensive node health verification
set -euo pipefail

RPC="http://localhost:9944"

# Check if node is responding
RESPONSE=$(curl -s -H "Content-Type: application/json" \
  -d '{"id":1,"jsonrpc":"2.0","method":"system_health","params":[]}' \
  $RPC 2>/dev/null)

if [ -z "$RESPONSE" ]; then
    echo "❌ Node RPC is not responding. Is the container running?"
    docker ps --filter name=midnight-node --format '{{.Status}}'
    exit 1
fi

PEERS=$(echo $RESPONSE | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['peers'])")
IS_SYNCING=$(echo $RESPONSE | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['isSyncing'])")
SHOULD_HAVE_PEERS=$(echo $RESPONSE | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['shouldHavePeers'])")

BLOCK=$(curl -s -H "Content-Type: application/json" \
  -d '{"id":1,"jsonrpc":"2.0","method":"chain_getHeader","params":[]}' \
  $RPC | python3 -c "import json,sys; print(int(json.load(sys.stdin)['result']['number'], 16))")

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Midnight Node Health Report"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Block height:    #$BLOCK"
echo "  Connected peers:  $PEERS"
echo "  Syncing:          $IS_SYNCING"
echo "  Should have peers: $SHOULD_HAVE_PEERS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$IS_SYNCING" = "false" ] && [ "$PEERS" -gt 0 ]; then
    echo "  ✅ Node is fully synced and healthy"
elif [ "$IS_SYNCING" = "true" ]; then
    echo "  ⏳ Node is still syncing. Check back later."
else
    echo "  ⚠️  Node reports not syncing but has no peers"
    echo "     This may indicate a network connectivity issue."
fi

if [ "$PEERS" -lt 3 ]; then
    echo "  ⚠️  Warning: low peer count ($PEERS). Check firewall."
fi
```

```bash
chmod +x health_check.sh
./health_check.sh
```

## Troubleshooting: The Node Stuck on Block 1

This is the most common issue, and it catches everyone the first time. Your node starts, shows `Idle (0 peers)`, and never progresses past block 1. Here's what's happening and how to fix it.

### Symptom 1: Zero Peers After 5+ Minutes

```
INFO sync 🟡 Idle (0 peers)
```

**Possible causes and fixes:**

**Firewall blocking port 30333.** The node needs outbound connections on this port. Check:

```bash
sudo ufw status
sudo ufw allow 30333/tcp
```

If you're behind a NAT (home router, cloud security group), verify the port isn't blocked inbound either:

```bash
# On AWS/AliCloud: check security group allows inbound TCP 30333
# On local network: check router port forwarding
```

**Wrong bootnode addresses.** Bootnodes change between network versions. If you copied bootnodes from an old tutorial, they may be dead. Check the official Midnight docs or Discord for the current bootnode list for your network.

**DNS resolution failure.** Some cloud environments block DNS or use restrictive resolvers. Test:

```bash
dig bootnode-1.preview.midnight.network +short
# Should return an IP address. If it times out, your DNS is broken.
```

Fix by switching to a public DNS resolver:

```bash
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
```

### Symptom 2: Peers Connect but Immediately Disconnect

```
INFO sync 🟢 Connected to 5 peers
INFO sync 🔴 Disconnected from peer: "connection dropped"
```

This almost always points to **storage I/O bottlenecks**. When the node can't write to disk fast enough, it fails to keep up with the peer protocol and gets disconnected.

**Verify your disk:**

```bash
# Check if you're on SSD (not HDD)
lsblk -d -o name,rota
# ROTA=0 means SSD. ROTA=1 means spinning disk — you need to switch.

# Check disk I/O during sync
iostat -x 2 5
# If %util is consistently >90%, your disk is the bottleneck.
```

**Fix:** Move to an SSD/NVMe volume. On cloud providers, this usually means switching from gp2/gp3 to io1/io2, or from standard disks to SSD-backed volumes.

### Symptom 3: Node Consumes All Available RAM

If your node gets OOM-killed during sync:

```
[12345.678] Out of memory: Killed process 6789 (midnight-node)
```

This happens when the node's database cache exceeds available memory during the initial bulk sync.

**Quick fix:** Add a swap file as a safety net:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

This doesn't make sync faster — it just prevents the OOM killer from terminating your node. The real fix is more RAM (16 GB recommended).

### Symptom 4: Corrupted Database After Crash

If the node crashes during sync and won't restart:

```
ERROR db 🗑️ Database corrupted at block #48291
```

**Option A: Delete and resync** (simplest but slowest):

```bash
docker stop midnight-node
docker rm midnight-node
docker volume rm midnight-node-data
# Restart with your original docker run command
```

**Option B: Use a snapshot** (if available). Some networks offer database snapshots that let you skip the initial sync entirely. Check the Midnight docs or community channels.

## Resource Requirements Summary

Here's the honest breakdown after running nodes on different hardware:

| Setup | Sync Time | Stable? | Notes |
|-------|-----------|---------|-------|
| 4 vCPU / 8 GB / 200 GB SATA SSD | 4–8 hours | Marginal | Peer churn under load |
| 4 vCPU / 8 GB / 200 GB NVMe | 1–2 hours | Good | Swap recommended |
| 8 vCPU / 16 GB / 500 GB NVMe | 30–60 min | Excellent | Production-ready |
| HDD (any config) | 12+ hours or stuck | No | Don't bother |

For **ongoing operation** (after initial sync), resource usage drops significantly. A synced node on Preview uses about 2–4 GB RAM and minimal CPU while idle. The heavy lifting only happens during the initial catch-up.

## Keeping Your Node Healthy

Once synced, your node should run autonomously. But you want to know when something breaks. Here's what to monitor:

**Block height progression.** Set up a cron job or monitoring script that checks block height every 5 minutes. If the block hasn't advanced in 10 minutes (Midnight produces blocks every ~6 seconds), something's wrong.

**Peer count.** A healthy node maintains 8–20 peers. Drop below 3 and investigate. Drop to 0 and your node is isolated.

**Disk usage.** The Preview testnet database grows over time. Monitor with:

```bash
docker exec midnight-node du -sh /data
```

Plan for 50–80 GB on Preview as of early 2026, growing steadily. Mainnet will be larger.

**Log rotation.** Without log rotation, your logs will fill the disk. The Docker Compose config above includes `max-size: "100m"` and `max-file: "5"` to cap logs at 500 MB. If using `docker run`, add:

```bash
--log-driver json-file --log-opt max-size=100m --log-opt max-file=5
```

## Connecting Other Tools to Your Node

Once your node is running, other Midnight tools can connect to it:

**Proof Server:** Set your DApp or wallet to use `http://localhost:6300` for the proof server (separate from the node). The node itself is accessed via WebSocket at `ws://localhost:9944`.

**Midnight.js SDK:** Configure the SDK to point to your local node:

```typescript
import { createNetworkConfig } from '@midnight-ntwrk/midnightjs';

const networkConfig = createNetworkConfig({
  nodeUrl: 'ws://localhost:9944',
  proofServerUrl: 'http://localhost:6300',
});
```

**Lace Wallet:** Go to Settings → Midnight → select "Local (ws://localhost:9944)" to route transactions through your node.

## Wrapping Up

Running a Midnight node isn't complicated once you know the failure modes. The three things that matter most:

1. **Use an SSD.** Everything else is secondary.
2. **Pin your image version.** Don't float on `latest`.
3. **Watch for the Idle (N peers) message.** That's your "it's working" signal.

The sync takes time — plan for at least an hour on good hardware. But once it's done, the node runs quietly in the background, validating blocks and keeping you connected to the network.

If you hit issues that aren't covered here, the Midnight Discord and forum are active. Include your node version (`docker logs midnight-node | head -5`), peer count, and the last 20 lines of logs when asking for help — it'll save everyone time.
