
# Running a Midnight Node: Setup, Sync & Monitoring — A Deep Dive

Running infrastructure for a new blockchain network usually feels like a mix of excitement and mild dread. You want it to work, you want it to stay working, and you'd really prefer not to spend three hours debugging why the node is stuck on the genesis block. I've been through that with Midnight, and this guide is the result.

Midnight is a privacy-focused blockchain built on the Polkadot SDK, operating as a Cardano Partnerchain. That "Partnerchain" detail matters: your Midnight node connects to the Cardano network and relies on Cardano block data flowing through a PostgreSQL-backed sync pipeline. If you've never touched a multi-component node architecture before, this guide walks you through it. If you have, the troubleshooting section will still be useful — I've spent too many late nights on "stuck on block 1" errors to let them go undocumented.

## Understanding the Architecture

Before touching any commands, it helps to understand what we're deploying. A Midnight node isn't a single Docker container — it's a stack of four components that need to communicate correctly.

```
┌─────────────────────────────────────────────────┐
│              Midnight Node                       │
│  P2P Networking · RPC · Chain Sync               │
│  (midnightntwrk/midnight-node:0.22.5)            │
└──────────────┬──────────────────────────────────┘
               │
    ┌──────────▼──────────┐
    │  PostgreSQL (DB)     │
    │  Block data storage  │
    └──────────┬───────────┘
               │
    ┌──────────▼───────────┐
    │  Cardano-db-sync      │
    │  Cardano → PG bridge  │
    └──────────┬────────────┘
               │
    ┌──────────▼───────────┐
    │  Cardano Node         │
    │  Partnerchain link    │
    └──────────────────────┘
```

1. **Midnight Node** — Core component. Handles P2P networking, exposes RPC on port `9944`, manages chain sync and consensus.

2. **Cardano-db-sync** — Reads Cardano blockchain data and writes it into PostgreSQL. Midnight depends on this as a Partnerchain.

3. **PostgreSQL** — Stores Cardano block data. Storage speed directly impacts sync performance.

4. **Cardano Node** — Maintains the connection to the Cardano network.

**Ordering matters: cardano-db-sync must be synced before the Midnight node can fully sync.** This is the single most common reason new operators get stuck on block 1.

### Quick Note on Consensus

Midnight uses Polkadot SDK infrastructure. Block time is 6 seconds, sessions last 1200 slots, and the hash function is blake2_256. Accounts use sr25519 public keys. The consensus combines ECDSA for Partnerchain consensus, ed25519 for finality, and sr25519 for AURA block authorship. These are baked into the node — you don't configure them manually, but understanding them helps when reading logs.

## Hardware Requirements

This is where people cut corners and then wonder why sync takes twelve hours instead of four. Midnight's stack is resource-intensive because you're running four services simultaneously:

| Role | CPU | RAM | Storage | Notes |
|------|-----|-----|---------|-------|
| Preview Full Node (minimum) | 4 vCPU | 16 GB | 150 GB SSD | Dev/testing |
| Preview Full Node (recommended) | 8 vCPU | 32 GB | 250 GB NVMe | Stable long-running |
| Mainnet Full Node | 8 vCPU | 32 GB+ | 500 GB NVMe | Production |
| Archive Node | 8+ vCPU | 32 GB+ | 1 TB+ NVMe | Full history |

**⚠️ The NVMe warning is real.** I tried running a Preview node on an HDD-backed VPS. Initial sync crawled at ~50 blocks per minute, peers kept disconnecting, and PostgreSQL stalled under write pressure. Switching to NVMe brought sync speed to 400+ blocks per minute and eliminated peer churn. Slow disks cause cascading failures — PostgreSQL write lag causes cardano-db-sync stalls, which causes Midnight node sync stalls, which causes peer timeouts.

For cloud deployments, I've had good results with DigitalOcean (8 CPU / 32 GB with premium storage), AWS m6i.2xlarge with gp3 minimum, and Hetzner CCX32 for price-to-performance.

## Prerequisites

Linux environment (Ubuntu 22.04/24.04 LTS, Debian 12, or Fedora 39+):

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y docker.io docker-compose-plugin \
    jq curl openssl postgresql-client netcat-openbsd \
    unzip git htop

sudo systemctl enable --now docker
docker --version
docker compose version
sudo usermod -aG docker $USER
```

**Important:** After adding yourself to the `docker` group, log out and back in (or run `newgrp docker`).

## Step 1: Setting Up the Environment

Create a clean workspace:

```bash
sudo mkdir -p /opt/midnight-node
sudo chown $USER:$USER /opt/midnight-node
cd /opt/midnight-node
mkdir -p data/cardano-node data/db-sync data/midnight-node
```

### Pinning Your Versions

**Never use `latest` tags.** Midnight releases frequently, and `latest` might point to an incompatible version:

| Network | Use Case | Node Image |
|---------|----------|------------|
| Preview | Dev/testing | `midnightntwrk/midnight-node:0.22.5` |
| Preprod | Pre-Mainnet testing | `midnightntwrk/midnight-node:0.22.2` |
| Mainnet | Production | `midnightntwrk/midnight-node:0.22.1` |

We'll use **Preview with 0.22.5**. Set environment variables in a `.env` file for easy upgrades and debugging:

```bash
# /opt/midnight-node/.env
MIDNIGHT_NETWORK=preview
MIDNIGHT_NODE_VERSION=0.22.5
MIDNIGHT_NODE_IMAGE=midnightntwrk/midnight-node:0.22.5
CARDANO_NETWORK=preview

# Bootnodes for Preview network
MIDNIGHT_BOOTNODE_1=/dns/bootnode-1.preview.midnight.network/tcp/30333/ws/p2p/12D3KooWK66i7dtGVNSwDh9tTeqov1q6LSdWsRLJvTyzTCaywYgK
MIDNIGHT_BOOTNODE_2=/dns/bootnode-2.preview.midnight.network/tcp/30333/ws/p2p/12D3KooWHqFfXFwb7WW4jwR8pr4BEf562v5M6c8K3CXAJq4Wx6ym

# PostgreSQL credentials (generate your own!)
POSTGRES_USER=midnight
POSTGRES_PASSWORD=$(openssl rand -hex 24)
POSTGRES_DB=cexplorer
```

**⚠️ Generate your own PostgreSQL password.** The `openssl rand -hex 24` command creates a secure 48-character hex string.

Create the environment files for Docker:

```bash
cat > postgres.env << EOF
POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=${POSTGRES_DB}
EOF

cat > midnight.env << EOF
MIDNIGHT_NETWORK=${MIDNIGHT_NETWORK}
CARDANO_NETWORK=${CARDANO_NETWORK}
MIDNIGHT_BOOTNODE_1=${MIDNIGHT_BOOTNODE_1}
MIDNIGHT_BOOTNODE_2=${MIDNIGHT_BOOTNODE_2}
DATABASE_HOST=db-sync-postgres
DATABASE_PORT=5432
DATABASE_USER=${POSTGRES_USER}
DATABASE_PASSWORD=${POSTGRES_PASSWORD}
DATABASE_NAME=${POSTGRES_DB}
EOF
```

## Step 2: Starting Cardano-db-sync

Remember the ordering rule: **cardano-db-sync must sync before the Midnight node.** Let's start with the database and sync pipeline.

### Launch PostgreSQL

```bash
docker run -d \
    --name db-sync-postgres \
    --env-file postgres.env \
    --restart unless-stopped \
    --network host \
    -v "$(pwd)/data/db-sync:/var/lib/postgresql/data" \
    postgres:16
```

Why `--network host`? Midnight's multi-component architecture works best when all containers share the host network. It eliminates Docker DNS resolution issues and port mapping headaches. The trade-off is that containers share the host's network namespace, but for a dedicated node server, this is the right choice.

Wait a few seconds for PostgreSQL to initialize, then verify it's running:

```bash
sleep 5
docker exec db-sync-postgres pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}
```

You should see something like:
```
/var/run/postgresql:5432 - accepting connections
```

### Start Cardano-db-sync

Now launch the Cardano database sync service:

```bash
docker run -d \
    --name cardano-db-sync \
    --env-file postgres.env \
    --restart unless-stopped \
    --network host \
    -v "$(pwd)/data/cardano-node:/data" \
    midnightntwrk/cardano-db-sync:0.12.0 \
    --config /config/preview-config.yaml \
    --socket-path /data/db/node.socket \
    --state-dir /data/db \
    --schema-dir /schema
```

The initial start will look quiet — that's normal. Cardano-db-sync needs to bootstrap its connection to the Cardano network. Give it a minute or two, then check:

```bash
docker logs cardano-db-sync --tail 50
```

A healthy sync log looks like:
```
[cardano-db-sync:Info:5] [2025-01-15 08:23:14.12 UTC] Chain DB started
[cardano-db-sync:Info:5] [2025-01-15 08:23:14.45 UTC] Opening connection to database
[cardano-db-sync:Info:5] [2025-01-15 08:23:14.78 UTC] Migration check passed
[cardano-db-sync:Info:5] [2025-01-15 08:23:15.01 UTC] Starting sync from epoch 142
```

### Monitoring Cardano-db-sync Progress

Here's a handy query to check sync progress directly from PostgreSQL:

```bash
docker exec -e PGPASSWORD="${POSTGRES_PASSWORD}" db-sync-postgres \
    psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -tAc \
    "SELECT 100 * (EXTRACT(EPOCH FROM (MAX(time) AT TIME ZONE 'UTC')) - EXTRACT(EPOCH FROM (MIN(time) AT TIME ZONE 'UTC'))) / (EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'UTC')) - EXTRACT(EPOCH FROM (MIN(time) AT TIME ZONE 'UTC'))) AS sync_percent FROM block;"
```

This returns a percentage — `100.0` means fully synced. During initial sync, you'll see this number climb steadily. On an 8 vCPU NVMe setup, full cardano-db-sync took about 3-4 hours. On minimum specs, budget 6-8 hours.

**💡 Tip:** While cardano-db-sync is catching up, you can move ahead and prepare the Midnight node. Just don't start it until the sync percentage is above 95%.

## Step 3: Deploying the Midnight Node

Once cardano-db-sync is making good progress, it's time to launch the main event. First, pull the exact image version:

```bash
docker pull midnightntwrk/midnight-node:0.22.5
docker image inspect midnightntwrk/midnight-node:0.22.5 --format='{{.Id}}'
```

Note the image ID — this is useful later if you need to verify you're running the right version after an upgrade.

### Starting the Node

```bash
docker run -d \
    --name midnight-node \
    --env-file midnight.env \
    --restart unless-stopped \
    --network host \
    -v "$(pwd)/data/midnight-node:/data" \
    -p 9944:9944 \
    midnightntwrk/midnight-node:0.22.5 \
    --base-path /data \
    --chain preview \
    --rpc-cors all \
    --rpc-methods unsafe \
    --name "my-midnight-node" \
    --prometheus-external
```

Let's break down the flags, because they matter:

| Flag | Purpose |
|------|---------|
| `--base-path /data` | Where the node stores its chain data and keys |
| `--chain preview` | Target network. Use `preview`, `preprod`, or your target network |
| `--rpc-cors all` | Allows all CORS origins. For production, restrict to your domain |
| `--rpc-methods unsafe` | Enables additional RPC methods. Required for some tooling |
| `--name "my-midnight-node"` | Human-readable name visible in peer lists and explorers |
| `--prometheus-external` | Exposes Prometheus metrics for monitoring |
| `-p 9944:9944` | Maps the RPC port. Already accessible with `--network host`, but explicit mapping helps |

### Verify the Node Starts Cleanly

```bash
docker logs midnight-node --tail 30
```

A clean startup looks like this:
```
2025-01-15 09:45:22.123  INFO main midnight::app: Starting Midnight node v0.22.5
2025-01-15 09:45:22.456  INFO main midnight::app: Chain: preview
2025-01-15 09:45:22.789  INFO main midnight::app: Database initialized
2025-01-15 09:45:23.012  INFO main midnight::network: Connecting to bootnodes
2025-01-15 09:45:23.345  INFO main midnight::network: Peer connected: 12D3KooW...
2025-01-15 09:45:24.001  INFO main midnight::sync: Sync state: Idle
2025-01-15 09:45:24.334  INFO main midnight::sync: Importing blocks from database
```

If you see connection errors or database failures, check the troubleshooting section below. Don't panic — these are usually configuration issues, not bugs.

## Step 4: Monitoring Sync Progress

Now comes the part where you watch numbers go up. There are three ways to check sync status, and each one tells you something different.

### Method 1: RPC Block Height

The most direct check — query the node's current block height:

```bash
curl -s -X POST http://localhost:9944 \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"chain_getBlockNumber","params":[],"id":1}' | jq
```

Response:
```json
{
  "jsonrpc": "2.0",
  "result": "0x2a3f5b",
  "id": 1
}
```

The `result` is a hex-encoded block number. `0x2a3f5b` in decimal is 2,764,635. Convert it with:

```bash
# One-liner to get decimal block number
curl -s -X POST http://localhost:9944 \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"chain_getBlockNumber","params":[],"id":1}' \
    | jq -r '.result' | xargs printf "%d\n"
```

### Method 2: System Health Check

This gives you peer count and whether the node is still syncing:

```bash
curl -s -X POST http://localhost:9944 \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"system_health","params":[],"id":1}' | jq
```

Response:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "peers": 12,
    "isSyncing": false,
    "shouldHavePeers": true
  },
  "id": 1
}
```

When `isSyncing` flips to `false` and you have multiple peers, you're in good shape. Zero peers is bad. One or two peers is fragile. Five or more is comfortable.

### Method 3: Chain Name Verification

Make absolutely sure you're on the right network:

```bash
curl -s -X POST http://localhost:9944 \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"system_chain","params":[],"id":1}' | jq
```

Response:
```json
{
  "jsonrpc": "2.0",
  "result": "Midnight Preview",
  "id": 1
}
```

If you don't see "Midnight Preview" (or your target network), something is wrong with your `--chain` flag or bootnode configuration.

### Real-Time Sync Monitoring Script

Here's a script I keep running in a tmux session during initial sync:

```bash
#!/bin/bash
# monitor_sync.sh — Real-time Midnight node sync monitor

RPC_URL="http://localhost:9944"

printf "%-12s | %-10s | %-8s | %-10s\n" "Timestamp" "Block Height" "Peers" "Syncing?"
printf "%-12s-+-%-10s-+-%-8s-+-%-10s\n" "------------" "----------" "--------" "----------"

while true; do
    BLOCK_HEX=$(curl -s -X POST "$RPC_URL" \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","method":"chain_getBlockNumber","params":[],"id":1}' \
        2>/dev/null | jq -r '.result // "error"' 2>/dev/null)

    if [[ "$BLOCK_HEX" == "error" || -z "$BLOCK_HEX" || "$BLOCK_HEX" == "null" ]]; then
        printf "%-12s | %-10s | %-8s | %-10s\n" \
            "$(date +%H:%M:%S)" "UNREACHABLE" "-" "-"
    else
        BLOCK_DEC=$(printf "%d" "$BLOCK_HEX" 2>/dev/null || echo "parse_error")
        HEALTH=$(curl -s -X POST "$RPC_URL" \
            -H "Content-Type: application/json" \
            -d '{"jsonrpc":"2.0","method":"system_health","params":[],"id":1}' 2>/dev/null)
        PEERS=$(echo "$HEALTH" | jq -r '.result.peers // "?"' 2>/dev/null)
        SYNCING=$(echo "$HEALTH" | jq -r '.result.isSyncing // "?"' 2>/dev/null)
        printf "%-12s | %-10s | %-8s | %-10s\n" \
            "$(date +%H:%M:%S)" "$BLOCK_DEC" "$PEERS" "$SYNCING"
    fi
    sleep 10
done
```

Save as `monitor_sync.sh`, run `chmod +x monitor_sync.sh`, and execute it. During sync, block heights climb. Once caught up, the rate slows to roughly one block every 6 seconds — the normal block time.

## Step 5: Verifying Node Health

Sync completion is just the beginning. A healthy node needs to stay healthy. Here's my health check checklist:

### ✅ Block Height is Advancing

Run the block height query and confirm the number changes every ~6 seconds:

```bash
for i in {1..5}; do
    curl -s -X POST http://localhost:9944 \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","method":"chain_getBlockNumber","params":[],"id":1}' \
        | jq -r '.result' | xargs printf "%d\n"
    sleep 6
done
```

Five consecutive outputs with increasing numbers means the node is processing blocks correctly.

### ✅ Peer Count is Stable

Check peer health:

```bash
curl -s -X POST http://localhost:9944 \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"system_health","params":[],"id":1}' | jq '.result'
```

A healthy node on Preview should show 5-20 peers. If you're seeing zero or one peer consistently, something's wrong — check the troubleshooting section.

### ✅ No OOM Events

Check if the kernel has killed your node process:

```bash
dmesg -T | grep -i "out of memory" | tail -5
```

If you see OOM kills, you need more RAM or you need to reduce the scope of other processes running on the same machine. Midnight's stack can use 12-16 GB under load.

### ✅ PostgreSQL is Responsive

```bash
docker exec db-sync-postgres pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}
```

If PostgreSQL isn't ready, nothing else works. Check disk space (`df -h`) and memory usage (`free -h`) first.

### ✅ Cardano-db-sync is Still Running

```bash
docker ps | grep cardano-db-sync
docker logs cardano-db-sync --tail 10
```

Look for recent log entries with current timestamps. Stale logs mean the process has stalled.

## Troubleshooting

This is the section I actually care about most. Everything above works if nothing goes wrong. But things go wrong. Let me walk through the problems I've actually seen and how to fix them.

### Problem 1: Node Stuck on Block 1

This is the most common issue, and it usually comes down to one of three root causes.

**Symptom:** Your node starts, connects to bootnodes, shows peer connections, but the block height never advances past 1 (or 0x1). The logs show sync attempts but no block imports.

**Root Cause A: Cardano-db-sync isn't synced.**

This is the #1 culprit. The Midnight node depends on cardano-db-sync having ingested Cardano block data. If cardano-db-sync is at 30%, the Midnight node literally cannot progress because it's missing the Partnerchain data it needs.

Fix: Wait for cardano-db-sync to complete. Check progress with the PostgreSQL query from Step 2. You need at least 95% before the Midnight node can start importing blocks meaningfully.

**Root Cause B: Wrong network configuration.**

If your `MIDNIGHT_NETWORK` is set to `preview` but you accidentally used `--chain preprod` (or vice versa), the node will connect to bootnodes but won't find any matching blocks.

Fix: Verify your chain flag matches your environment:
```bash
docker exec midnight-node cat /data/chainspec.json 2>/dev/null || echo "No chainspec found"
```

Also double-check your `.env` file:
```bash
echo "Network: $MIDNIGHT_NETWORK"
echo "Chain flag: $(docker inspect midnight-node --format '{{range .Args}}{{.}} {{end}}')"
```

**Root Cause C: Firewall blocking P2P traffic.**

The node needs port 30333 open for P2P connections. If it's blocked, the node can connect outbound to bootnodes but can't accept inbound connections or maintain stable peer relationships.

Fix:
```bash
# Check if port 30333 is open
nc -zv localhost 30333 2>&1 || echo "Port 30333 not accessible"

# On UFW:
sudo ufw allow 30333/tcp

# On firewalld:
sudo firewall-cmd --permanent --add-port=30333/tcp
sudo firewall-cmd --reload
```

### Problem 2: Peer Churn (Constant Disconnects)

**Symptom:** You see peers connecting and disconnecting repeatedly in logs. Peer count oscillates between 0 and 3. Your node syncs intermittently and falls behind.

**Cause 1: Slow disk (HDD).**

This is the NVMe warning again, now with consequences. If PostgreSQL can't write blocks fast enough, cardano-db-sync stalls. When cardano-db-sync stalls, the Midnight node has nothing to import. When the node has nothing to import, it looks unresponsive to peers, and they disconnect.

Fix: Migrate to NVMe storage. On cloud providers, this usually means upgrading your disk type. There's no workaround — the write throughput requirement is real.

**Cause 2: Insufficient RAM.**

The full stack (Midnight node + PostgreSQL + cardano-db-sync + Cardano node) can consume 12-20 GB under load. If you're on an 8 GB instance, the kernel will start killing processes.

Fix: Check for OOM events:
```bash
dmesg -T | grep -i "killed process" | tail -10
```

If you see kills, upgrade to at least 16 GB RAM, preferably 32 GB.

**Cause 3: Version mismatch.**

If your node is running 0.22.5 but your peers are on 0.22.1 (or vice versa), protocol differences can cause disconnections.

Fix: Ensure all nodes in the network are on compatible versions. Check the latest recommended version in the Midnight documentation or Discord announcements.

### Problem 3: OOM Kills

**Symptom:** The node was running fine, then suddenly stopped. `docker ps` shows it's not running, and `dmesg` shows an OOM kill.

Fix:
```bash
# Check what was killed
dmesg -T | grep -i "oom" | tail -5

# Current memory usage
docker stats --no-stream

# System-wide memory
free -h
```

If you're genuinely out of RAM, you have three options:
1. **Upgrade RAM** (best solution)
2. **Add swap space** as a safety net:
```bash
sudo fallocate -l 8G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
3. **Reduce other services** on the same machine

Swap is a band-aid, not a cure. The node will run slower with swap, but at least it won't crash.

### Problem 4: Zero Peers for Extended Period

**Symptom:** `system_health` returns `"peers": 0` and stays there for more than 5 minutes.

Checklist:
1. **Bootnode configuration** — Are your bootnode env vars set correctly?
```bash
docker inspect midnight-node --format '{{range .Config.Env}}{{println .}}{{end}}' | grep BOOTNODE
```

2. **Outbound connectivity** — Can the container reach the bootnodes?
```bash
docker exec midnight-node ping -c 3 bootnode-1.preview.midnight.network
```

3. **DNS resolution** — Some containers have DNS issues with `--network host`:
```bash
docker exec midnight-node nslookup bootnode-1.preview.midnight.network
```

4. **Check Docker logs for connection errors:**
```bash
docker logs midnight-node --tail 100 2>&1 | grep -i "error\|failed\|timeout"
```

### Problem 5: PostgreSQL Connection Failures

**Symptom:** Midnight node logs show database connection errors like `Connection refused` or `authentication failed`.

Fix:
1. Verify PostgreSQL is running:
```bash
docker ps | grep db-sync-postgres
```

2. Test connection from the host:
```bash
PGPASSWORD="${POSTGRES_PASSWORD}" psql -h localhost -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -c "SELECT 1;"
```

3. If the password is wrong, recreate the env files:
```bash
# Stop everything
docker stop midnight-node cardano-db-sync db-sync-postgres
docker rm midnight-node cardano-db-sync db-sync-postgres

# Regenerate password
export POSTGRES_PASSWORD=$(openssl rand -hex 24)

# Recreate env files and restart
```

## Ongoing Maintenance

Your node is running. Now what? Here's how to keep it healthy over time.

### Upgrading the Node

When a new version drops (check the Midnight Discord or GitHub releases):

```bash
# Pull the new image
docker pull midnightntwrk/midnight-node:0.22.6

# Stop and remove the current node (NOT cardano-db-sync or PostgreSQL)
docker stop midnight-node
docker rm midnight-node

# Update .env with the new version, then restart
docker run -d \
    --name midnight-node \
    --env-file midnight.env \
    --restart unless-stopped \
    --network host \
    -v "$(pwd)/data/midnight-node:/data" \
    -p 9944:9944 \
    midnightntwrk/midnight-node:0.22.6 \
    --base-path /data \
    --chain preview \
    --rpc-cors all \
    --rpc-methods unsafe \
    --name "my-midnight-node" \
    --prometheus-external

# Verify
docker logs midnight-node --tail 20
curl -s -X POST http://localhost:9944 \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"system_health","params":[],"id":1}' | jq
```

The node picks up where it left off since the data directory is persisted.

### Log Rotation

Docker logs can grow large over time. Set up log rotation to prevent disk space issues:

```bash
# Create Docker daemon config for log rotation
sudo mkdir -p /etc/docker
sudo cat > /etc/docker/daemon.json << 'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "3"
  }
}
EOF

# Restart Docker to apply
sudo systemctl restart docker
```

This caps each container's log at 100 MB and keeps only the 3 most recent rotated files. That's 300 MB max per container — perfectly reasonable.

### Automated Health Check Cron

Here's a lightweight cron script that emails you if something's wrong:

```bash
#!/bin/bash
# health_check.sh — Automated Midnight node health check
# Add to crontab: */5 * * * * /opt/midnight-node/health_check.sh

RPC_URL="http://localhost:9944"
EMAIL="admin@example.com"

# Check if node is responding
HEALTH=$(curl -s -m 10 -X POST "$RPC_URL" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"system_health","params":[],"id":1}' 2>/dev/null)

if [ -z "$HEALTH" ]; then
    echo "CRITICAL: Midnight node is not responding on $RPC_URL" | mail -s "Midnight Node Down" "$EMAIL"
    exit 1
fi

PEERS=$(echo "$HEALTH" | jq -r '.result.peers // 0')
SYNCING=$(echo "$HEALTH" | jq -r '.result.isSyncing // true')

if [ "$PEERS" -eq 0 ] 2>/dev/null; then
    echo "WARNING: Midnight node has 0 peers" | mail -s "Midnight Node: Zero Peers" "$EMAIL"
fi

# Check block height is advancing
BLOCK1=$(curl -s -m 10 -X POST "$RPC_URL" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"chain_getBlockNumber","params":[],"id":1}' 2>/dev/null | jq -r '.result')
sleep 12
BLOCK2=$(curl -s -m 10 -X POST "$RPC_URL" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"chain_getBlockNumber","params":[],"id":1}' 2>/dev/null | jq -r '.result')

if [ "$BLOCK1" = "$BLOCK2" ] && [ "$SYNCING" = "false" ]; then
    echo "WARNING: Block height not advancing (syncing=false). Possible stall." | mail -s "Midnight Node: Block Height Stalled" "$EMAIL"
fi
```

Add it to crontab:
```bash
(crontab -l 2>/dev/null; echo "*/5 * * * * /opt/midnight-node/health_check.sh") | crontab -
```

### Security Hardening

A few quick wins:

1. **Restrict RPC access** — If you don't need external RPC access, bind to localhost only:
```bash
# Change --rpc-cors all to specific origins
# Or use iptables to block external access to 9944:
sudo iptables -A INPUT -p tcp --dport 9944 ! -s 127.0.0.1 -j DROP
```

2. **Run Docker as non-root** — Docker itself needs root, but you can run the node user-space container processes under a dedicated user:
```bash
sudo useradd -r -s /bin/false midnight-node
```

3. **Enable UFW firewall:**
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp        # SSH
sudo ufw allow 30333/tcp     # Midnight P2P
sudo ufw allow from 127.0.0.1 to any port 9944  # RPC (local only)
sudo ufw enable
```

## Conclusion

Running a Midnight node is more involved than spinning up a single-container blockchain node, but the multi-component architecture is what enables its Partnerchain functionality on Cardano. Once you understand the dependency chain — PostgreSQL ← cardano-db-sync ← Midnight node — most troubleshooting becomes straightforward.

Key takeaways:

- **Pin your versions.** Never use `latest`. Use 0.22.5 for Preview.
- **Use NVMe storage.** HDDs cause peer churn and sync stalls.
- **Sync cardano-db-sync first.** The Midnight node can't advance without Cardano block data.
- **Monitor peer count and block height.** Your two canary metrics.
- **Watch for OOM kills.** 16 GB RAM minimum, 32 GB recommended.
- **Keep port 30333 open.** P2P traffic needs to flow.

The Midnight network is still evolving, and the tooling will get easier over time. But for now, if you can get a node running and keep it healthy, you're already ahead of most people trying to interact with the network. And when something breaks — because something always breaks — you'll have the diagnostic skills to figure out why.

If you run into issues that aren't covered here, the Midnight developer forum and Discord are active communities. Drop your logs, describe what you've tried, and someone will usually point you in the right direction.

## Links & Further Reading

- **Midnight Documentation**: https://docs.midnight.network
- **Midnight Node Docker Repository**: https://github.com/midnightntwrk/midnight-node-docker
- **Developer Forum**: https://forum.midnight.network
- **Discord Community**: https://discord.com/invite/midnightnetwork
- **Polkadot.js Apps (Explorer)**: https://polkadot.js.org/apps
- **Polkadot SDK Documentation**: https://paritytech.github.io/polkadot-sdk/master/polkadot_sdk_docs/polkadot_sdk/index.html

Happy node running. 🌙
