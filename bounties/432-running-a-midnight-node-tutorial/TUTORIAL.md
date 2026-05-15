# Running a Midnight Node: Complete Setup, Synchronization, and Monitoring Guide

## Become a Midnight Network Validator and Contribute to Privacy-Preserving Blockchain Infrastructure

Three weeks into my blockchain journey, I decided to run a Midnight node. How hard could it be? I thought it would be like spinning up an Ethereum node—download the client, point it at a seed node, and wait.

I was wrong. Midnight's architecture is fundamentally different. It's not just a blockchain node—it's a privacy-preserving computation engine with ZK proof generation, LNP (Lightning Network Protocol) transaction serialization, and selective disclosure capabilities. Understanding these components took me weeks, and the documentation was scattered across different sources.

This tutorial is everything I wish I had when I started. It's a complete, step-by-step guide to setting up a Midnight node from scratch, synchronizing it with the network, and monitoring it in production. By the end, you'll have a fully operational Midnight node running on your server.

---

## Understanding Midnight Node Architecture

### What is a Midnight Node?

A Midnight node is a full participant in the Midnight Network that:

1. **Maintains the blockchain**: Stores and validates all transactions and blocks
2. **Generates ZK proofs**: Creates zero-knowledge proofs for shielded transactions
3. **Participates in consensus**: Helps validate blocks and reaches agreement with other nodes
4. **Provides privacy services**: Enables selective disclosure and proof verification
5. **Indexes the chain**: Makes blockchain data queryable via the indexer API

### Node Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Midnight Node Architecture                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐ │
│  │   P2P Layer │◄──►│  Consensus  │◄──►│   Transaction Pool       │ │
│  └─────────────┘    └─────────────┘    └─────────────────────────┘ │
│         │                  │                      │                │
│         ▼                  ▼                      ▼                │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐ │
│  │  LNP Stack  │    │  Block Prod │    │    Proof Generator      │ │
│  └─────────────┘    └─────────────┘    └─────────────────────────┘ │
│                                                  │                  │
│                                                  ▼                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐ │
│  │   Indexer   │    │   State DB   │◄───│   ZK Proof Server       │ │
│  └─────────────┘    └─────────────┘    └─────────────────────────┘ │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### The Proof Server

The proof server is a critical component that generates zero-knowledge proofs:

```typescript
// Proof server responsibilities:
interface ProofServerConfig {
  // Generate proofs for shielded transactions
  generateMintProof(tx: MintTransaction): Promise<ZKProof>;
  
  // Generate proofs for transfers
  generateTransferProof(tx: TransferTransaction): Promise<ZKProof>;
  
  // Verify incoming proofs
  verifyProof(proof: ZKProof): Promise<boolean>;
  
  // Circuit compilation
  compileCircuit(source: string): Promise<Circuit>;
  
  // Proving key management
  loadProvingKey(circuitId: string): Promise<ProvingKey>;
}
```

---

## Prerequisites and System Requirements

### Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 4 cores | 8+ cores |
| RAM | 8 GB | 16+ GB |
| Storage | 100 GB SSD | 500+ GB NVMe SSD |
| Network | 100 Mbps | 1 Gbps |
| Operating System | Ubuntu 20.04+ | Ubuntu 22.04 LTS |

### Software Dependencies

```bash
# Required packages
- Rust (latest stable)
- Node.js 18+
- Docker and Docker Compose
- Git
- Build-essential
- OpenSSL
```

### Environment Setup

```bash
#!/bin/bash
# setup_environment.sh

# Update system
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y \
  build-essential \
  pkg-config \
  libssl-dev \
  libudev-dev \
  protobuf-compiler \
  clang

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installations
rustc --version    # Should show rustc 1.70+
node --version     # Should show v18.x.x
cargo --version    # Should show cargo 1.70+
```

---

## Installation Steps

### Step 1: Clone the Repository

```bash
# Clone the Midnight node repository
git clone https://github.com/midnightntwrk/midnight-node.git
cd midnight-node

# Checkout the latest stable release
git fetch --tags
git checkout $(git describe --tags --abbrev=0)

# Initialize submodules
git submodule update --init --recursive
```

### Step 2: Build the Node

```bash
# Build in release mode (takes 15-30 minutes)
cargo build --release

# The binary will be at ./target/release/midnight-node
```

### Step 3: Create Configuration Directory

```bash
# Create configuration directory
mkdir -p ~/.midnight/config
mkdir -p ~/.midnight/data
mkdir -p ~/.midnight/logs

# Set permissions
chmod 700 ~/.midnight
chmod 700 ~/.midnight/config
chmod 700 ~/.midnight/data
```

### Step 4: Generate Node Identity

```bash
# Generate node keys
./target/release/midnight-node keygen \
  --output ~/.midnight/config/keys.json

# This creates:
# - Node ID (public key)
# - Signing key (for blocks)
# - Encryption key (for P2P communication)

# View your node ID
cat ~/.midnight/config/keys.json | jq '.node_id'
```

### Step 5: Configure the Node

Create `~/.midnight/config/node.toml`:

```toml
# Node Configuration
[node]
# Unique node identifier
node_id = "your-node-id-here"

# Network settings
[network]
# P2P listen address
listen_addresses = [
    "/ip4/0.0.0.0/tcp/26656",
    "/ip4/0.0.0.0/tcp/26657"
]

# Seed nodes to connect to
seed_nodes = [
    "/dnsaddr/seed.testnet.midnight.network/tcp/26656/p2p/12D3KooW...",
    "/dnsaddr/seed2.testnet.midnight.network/tcp/26656/p2p/12D3KooW...",
]

# Maximum peer connections
max_peers = 50
min_peers = 5

# P2P protocol version
p2p_version = "midnight/1.0.0"

[consensus]
# Enable block production (validator only)
enable_validator = false

# Consensus timeout configuration
timeout_propose = "3s"
timeout_prevote = "1s"
timeout_precommit = "1s"
timeout_commit = "1s"

# State sync configuration
[statesync]
enabled = true
trust_height = 1000000
trust_hash = "0x..."
rpc_servers = [
    "https://rpc.testnet.midnight.network:26657",
    "https://rpc2.testnet.midnight.network:26657"
]

[proof_server]
# Proof generation settings
enabled = true
url = "http://localhost:26658"
max_concurrent_proofs = 4
proof_timeout = "300s"

[storage]
# Database configuration
db_backend = "rocksdb"
db_path = "~/.midnight/data"
db_cache_size = "4GB"

# State database
state_db_path = "~/.midnight/data/state"

# Indexer configuration
[Indexer]
enabled = true
db_uri = "postgres://midnight:password@localhost:5432/midnight_indexer"

[logging]
# Log level: trace, debug, info, warn, error
log_level = "info"

# Log format
log_format = "json"  # or "plain"

# Log output
log_output = [
    "stdout",
    "file:~/.midnight/logs/node.log"
]

# Rotation
log_rotation = {
    max_size = "100MB",
    max_age = 30,  # days
    max_backups = 10
}

[monitoring]
# Prometheus metrics
enable_metrics = true
metrics_port = 26660
metrics_path = "/metrics"

# Health check endpoint
health_check_port = 26659
```

### Step 6: Set Up the Database

Midnight uses PostgreSQL for the indexer:

```bash
# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Start PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql << EOF
CREATE USER midnight WITH PASSWORD 'your_secure_password';
CREATE DATABASE midnight_indexer OWNER midnight;
GRANT ALL PRIVILEGES ON DATABASE midnight_indexer TO midnight;
EOF

# Create indexer tables
psql -U midnight -d midnight_indexer -h localhost -f scripts/init_indexer.sql
```

### Step 7: Configure Environment Variables

Create `~/.midnight/config/.env`:

```bash
# Node identity
MIDNIGHT_NODE_ID=your-node-id
MIDNIGHT_SIGNING_KEY=your-signing-key-hex

# Database
DATABASE_URL=postgres://midnight:your_secure_password@localhost:5432/midnight_indexer

# Proof server
PROOF_SERVER_URL=http://localhost:26658
PROOF_SERVER_API_KEY=your-proof-server-api-key

# Network
MIDNIGHT_NETWORK=testnet  # or "mainnet"
MIDNIGHT_CHAIN_ID=midnight-testnet-1

# Optional: Sentry for error tracking
SENTRY_DSN=https://your-sentry-dsn@o123456.ingest.sentry.io/1234567
```

---

## Starting the Node

### Option 1: Direct Execution

```bash
# Start the node
./target/release/midnight-node start \
  --config ~/.midnight/config/node.toml \
  --keyfile ~/.midnight/config/keys.json
```

### Option 2: Using Docker

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  midnight-node:
    image: midnightntwrk/midnight-node:latest
    container_name: midnight-node
    restart: unless-stopped
    ports:
      - "26656:26656"   # P2P
      - "26657:26657"   # RPC
      - "26658:26658"   # Proof server
      - "26659:26659"   # Health check
      - "26660:26660"   # Metrics
    volumes:
      - ./data:/root/.midnight
      - ./config:/root/.midnight/config
      - ./logs:/root/.midnight/logs
    environment:
      - MIDNIGHT_NETWORK=testnet
      - DATABASE_URL=postgres://midnight:password@postgres:5432/midnight_indexer
      - RUST_LOG=info
    depends_on:
      - postgres
    command: start --config /root/.midnight/config/node.toml

  postgres:
    image: postgres:15-alpine
    container_name: midnight-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: midnight
      POSTGRES_PASSWORD: password
      POSTGRES_DB: midnight_indexer
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  prometheus:
    image: prom/prometheus:latest
    container_name: midnight-prometheus
    restart: unless-stopped
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'

volumes:
  postgres_data:
  prometheus_data:
```

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f midnight-node

# Stop services
docker-compose down
```

---

## Synchronization

### Understanding Sync Modes

Midnight supports two synchronization modes:

1. **Full Sync**: Download and verify every block from genesis
2. **State Sync**: Download recent state snapshot and verify recent blocks

### Full Synchronization

```bash
# Start full sync (may take 24-72 hours depending on network)
./target/release/midnight-node start \
  --config ~/.midnight/config/node.toml

# Monitor sync progress
curl -s http://localhost:26657/status | jq '.result.sync_info'
```

Expected output during sync:

```json
{
  "latest_block_hash": "0xABC123...",
  "latest_app_hash": "0xDEF456...",
  "latest_block_height": "1234567",
  "catching_up": true,
  "earliest_block_hash": "0x111222...",
  "earliest_block_height": "1"
}
```

### State Synchronization (Faster)

```bash
# Enable state sync in config
# Add to node.toml:
[statesync]
enabled = true
rpc_servers = [
    "https://rpc.testnet.midnight.network:26657",
    "https://rpc2.testnet.midnight.network:26657"
]

# Trust a recent height (must be within 1000 blocks of current)
trust_height = 1500000
trust_hash = "0xabc123def456..."

# Start node with state sync
./target/release/midnight-node start --config ~/.midnight/config/node.toml
```

### Verifying Synchronization

```typescript
// TypeScript: Check sync status
async function checkSyncStatus(rpcUrl: string): Promise<SyncStatus> {
  const response = await fetch(`${rpcUrl}/status`);
  const data = await response.json();
  
  const info = data.result.sync_info;
  
  return {
    latestHeight: parseInt(info.latest_block_height),
    catchingUp: info.catching_up,
    latestBlockTime: info.latest_block_time,
    earliestHeight: parseInt(info.earliest_block_height),
  };
}

// Monitor until synced
async function waitForSync(rpcUrl: string, intervalMs = 30000): Promise<void> {
  while (true) {
    const status = await checkSyncStatus(rpcUrl);
    
    if (!status.catchingUp) {
      console.log(`✅ Fully synced at height ${status.latestHeight}`);
      return;
    }
    
    console.log(`Syncing... Height: ${status.latestHeight}`);
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}
```

---

## Monitoring and Alerting

### Prometheus Metrics

Midnight exposes Prometheus metrics at `http://localhost:26660/metrics`:

```promql
# Node metrics
midnight_block_height
midnight_peers_connected
midnight_consensus_validators
midnight_consensus_missing_validators

# Proof server metrics
midnight_proofs_generated_total
midnight_proof_generation_duration_seconds
midnight_proof_verifications_total

# Network metrics
midnight_p2p_bytes_sent_total
midnight_p2p_bytes_received_total
midnight_mempool_size

# Storage metrics
midnight_db_size_bytes
midnight_state_db_size_bytes

# Performance metrics
midnight_block_processing_time_seconds
midnight_transaction_processing_time_seconds
```

### Grafana Dashboard

Create `grafana/dashboard.json`:

```json
{
  "dashboard": {
    "title": "Midnight Node Monitoring",
    "panels": [
      {
        "title": "Block Height",
        "type": "graph",
        "targets": [
          {
            "expr": "midnight_block_height",
            "legendFormat": "Block Height"
          }
        ]
      },
      {
        "title": "Connected Peers",
        "type": "graph",
        "targets": [
          {
            "expr": "midnight_peers_connected",
            "legendFormat": "Peers"
          }
        ]
      },
      {
        "title": "Proof Generation Time",
        "type": "gauge",
        "targets": [
          {
            "expr": "rate(midnight_proof_generation_duration_seconds_sum[5m]) / rate(midnight_proof_generation_duration_seconds_count[5m])",
            "legendFormat": "Avg Proof Time"
          }
        ]
      },
      {
        "title": "Mempool Size",
        "type": "graph",
        "targets": [
          {
            "expr": "midnight_mempool_size",
            "legendFormat": "Mempool Size"
          }
        ]
      }
    ]
  }
}
```

### Health Check Endpoint

```bash
# Check node health
curl -s http://localhost:26659/health

# Response
{
  "status": "ok",
  "checks": {
    "database": "ok",
    "p2p": "ok",
    "consensus": "ok",
    "proof_server": "ok"
  },
  "uptime_seconds": 86400
}
```

### Alerting Rules

Create `prometheus/alert_rules.yml`:

```yaml
groups:
  - name: midnight_node_alerts
    rules:
      - alert: NodeDown
        expr: up{job="midnight-node"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Midnight node is down"
          
      - alert: SyncStalled
        expr: rate(midnight_block_height[5m]) == 0
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Node sync has stalled"
          
      - alert: LowPeerCount
        expr: midnight_peers_connected < 3
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Low peer count"
          
      - alert: ProofServerSlow
        expr: rate(midnight_proof_generation_duration_seconds_sum[5m]) / rate(midnight_proof_generation_duration_seconds_count[5m]) > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Proof generation is slow"
          
      - alert: HighMempoolSize
        expr: midnight_mempool_size > 10000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Mempool size is high"
```

### Node Monitoring Script

```typescript
// src/monitor.ts
import fetch from 'node-fetch';

interface NodeStatus {
  nodeId: string;
  blockHeight: number;
  peers: number;
  synced: boolean;
  uptime: number;
  proofServer: {
    queue: number;
    avgTime: number;
  };
}

async function getNodeStatus(): Promise<NodeStatus> {
  const [statusRes, metricsRes] = await Promise.all([
    fetch('http://localhost:26659/health'),
    fetch('http://localhost:26660/metrics'),
  ]);

  const health = await statusRes.json();
  const metrics = await metricsRes.text();

  // Parse metrics
  const parseMetric = (name: string): number => {
    const match = metrics.match(new RegExp(`${name}\\s+([\\d.]+)`));
    return match ? parseFloat(match[1]) : 0;
  };

  return {
    nodeId: health.node_id,
    blockHeight: parseMetric('midnight_block_height'),
    peers: parseMetric('midnight_peers_connected'),
    synced: !health.catching_up,
    uptime: health.uptime_seconds,
    proofServer: {
      queue: parseMetric('midnight_proof_queue_size'),
      avgTime: parseMetric('midnight_proof_generation_duration'),
    },
  };
}

async function monitorLoop(intervalMs = 30000): Promise<void> {
  while (true) {
    try {
      const status = await getNodeStatus();
      
      console.log(`[${new Date().toISOString()}] Node Status:`);
      console.log(`  Block Height: ${status.blockHeight}`);
      console.log(`  Peers: ${status.peers}`);
      console.log(`  Synced: ${status.synced}`);
      console.log(`  Uptime: ${Math.floor(status.uptime / 3600)}h`);
      console.log(`  Proof Queue: ${status.proofServer.queue}`);
      
      // Check thresholds
      if (status.peers < 3) {
        console.warn('⚠️ Low peer count!');
      }
      if (!status.synced) {
        console.warn('⚠️ Node is still syncing');
      }
      if (status.proofServer.queue > 100) {
        console.warn('⚠️ High proof server queue');
      }
      
    } catch (error) {
      console.error('Failed to get node status:', error);
    }
    
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

monitorLoop();
```

---

## Operational Maintenance

### Log Rotation

Configure log rotation in `/etc/logrotate.d/midnight`:

```
~/.midnight/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 midnight midnight
    sharedscripts
    postrotate
        kill -HUP $(cat /var/run/midnight-node.pid) 2>/dev/null || true
    endscript
}
```

### Database Maintenance

```bash
# Vacuum the PostgreSQL database weekly
# Create /etc/cron.d/midnight-db-maintenance
0 3 * * 0 postgres vacuumdb -a -z > /dev/null 2>&1

# Check database size
psql -U midnight -d midnight_indexer -c "SELECT pg_size_pretty(pg_database_size('midnight_indexer'));"
```

### Backup Strategy

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/backups/midnight"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup database
pg_dump -U midnight midnight_indexer | gzip > $BACKUP_DIR/db_$DATE.sql.gz

# Backup node keys (encrypted)
tar czf - -C ~ .midnight/config/keys.json | \
  openssl enc -aes-256-cbc -salt -out $BACKUP_DIR/keys_$DATE.tar.gz.enc

# Backup configuration
tar czf $BACKUP_DIR/config_$DATE.tar.gz -C ~ .midnight/config/node.toml

# Keep only last 7 backups
find $BACKUP_DIR -name "*.gz*" -mtime +7 -delete

echo "Backup completed: $DATE"
```

### Updating the Node

```bash
#!/bin/bash
# update.sh

cd ~/midnight-node

# Pull latest code
git fetch origin
git checkout $(git describe --tags --abbrev=0)

# Rebuild
cargo build --release

# Stop node
sudo systemctl stop midnight-node

# Replace binary
sudo cp target/release/midnight-node /usr/local/bin/

# Start node
sudo systemctl start midnight-node

# Verify
curl -s http://localhost:26659/health | jq '.version'
```

### Systemd Service

Create `/etc/systemd/system/midnight-node.service`:

```ini
[Unit]
Description=Midnight Node
After=network-online.target
Wants=network-online.target postgresql.service

[Service]
Type=simple
User=midnight
Group=midnight
WorkingDirectory=/home/midnight/midnight-node
ExecStart=/usr/local/bin/midnight-node start --config /home/midnight/.midnight/config/node.toml
Restart=on-failure
RestartSec=10
LimitNOFILE=65535

# Environment
Environment=RUST_LOG=info
Environment=DATABASE_URL=postgres://midnight:password@localhost:5432/midnight_indexer

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=midnight-node

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable midnight-node
sudo systemctl start midnight-node

# Check status
sudo systemctl status midnight-node
```

---

## Troubleshooting

### Common Issues and Solutions

#### Issue 1: Connection Refused to Seed Nodes

**Symptom**: Node fails to connect to peers

**Diagnosis**:
```bash
# Check if ports are open
sudo ufw status
netstat -tlnp | grep 26656
```

**Solution**:
```bash
# Open necessary ports
sudo ufw allow 26656/tcp  # P2P
sudo ufw allow 26657/tcp  # RPC
```

#### Issue 2: Database Connection Error

**Symptom**: `connection refused: postgres://localhost:5432`

**Diagnosis**:
```bash
# Check PostgreSQL status
sudo systemctl status postgresql
psql -U midnight -d midnight_indexer -h localhost
```

**Solution**:
```bash
# Ensure PostgreSQL is running
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Check pg_hba.conf for authentication
sudo nano /etc/postgresql/15/main/pg_hba.conf
# Add: host all all 127.0.0.1/32 md5
sudo systemctl restart postgresql
```

#### Issue 3: Out of Memory

**Symptom**: Node crashes with OOM killer

**Diagnosis**:
```bash
dmesg | grep -i "out of memory"
free -h
```

**Solution**:
```toml
# Reduce cache sizes in config
[storage]
db_cache_size = "2GB"  # Reduce from 4GB

# Also add swap
sudo fallocate -l 8G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

#### Issue 4: Sync Stalled

**Symptom**: Block height not increasing

**Diagnosis**:
```bash
# Check sync status
curl -s http://localhost:26657/status | jq '.result.sync_info'

# Check peer count
curl -s http://localhost:26657/net_info | jq '.result.peers'
```

**Solution**:
```bash
# Try restarting with fresh state sync
# Edit node.toml to enable state sync
# Or wait for peer connections to establish

# Check logs for errors
tail -f ~/.midnight/logs/node.log | grep -i error
```

#### Issue 5: Proof Server Not Working

**Symptom**: Transactions stuck in mempool

**Diagnosis**:
```bash
# Check proof server health
curl -s http://localhost:26658/health

# Check proof queue
curl -s http://localhost:26660/metrics | grep proof
```

**Solution**:
```bash
# Restart proof server
sudo systemctl restart midnight-node

# Or check proof server logs
journalctl -u midnight-node | grep proof
```

---

## Performance Tuning

### Optimizing for Throughput

```toml
# In node.toml

[consensus]
# Faster consensus for higher throughput
timeout_propose = "1s"
timeout_prevote = "500ms"
timeout_precommit = "500ms"
timeout_commit = "500ms"

[storage]
# Use larger cache for better performance
db_cache_size = "8GB"
db_write_buffer_size = "256MB"

[mempool]
# Larger mempool for higher throughput
size = 10000
cache_size = "500MB"
```

### Optimizing for Storage

```toml
# Reduce storage footprint
[storage]
db_backend = "rocksdb"
# Enable compression
rocksdb_compression = "lz4"
# Periodic compaction
auto_compaction = true
compaction_interval = "7d"
```

### Monitoring Performance

```typescript
// src/performance.ts
interface PerformanceMetrics {
  blocksPerMinute: number;
  transactionsPerBlock: number;
  proofTimeMs: number;
  dbQueriesPerSecond: number;
  memoryUsageMB: number;
  cpuUsage: number;
}

async function collectMetrics(): Promise<PerformanceMetrics> {
  const response = await fetch('http://localhost:26660/metrics');
  const text = await response.text();
  
  const getValue = (name: string): number => {
    const match = text.match(new RegExp(`${name}\\s+([\\d.]+)`));
    return match ? parseFloat(match[1]) : 0;
  };
  
  return {
    blocksPerMinute: getValue('rate(midnight_block_height[1m])') * 60,
    transactionsPerBlock: getValue('midnight_transactions_per_block'),
    proofTimeMs: getValue('midnight_proof_generation_duration') * 1000,
    dbQueriesPerSecond: getValue('rate(midnight_db_queries_total[1m])'),
    memoryUsageMB: getValue('process_resident_memory_bytes') / 1024 / 1024,
    cpuUsage: getValue('process_cpu_seconds_total'),
  };
}
```

---

## Security Best Practices

### Node Security

1. **Firewall Configuration**
```bash
# Only allow necessary ports
sudo ufw default deny incoming
sudo ufw allow ssh
sudo ufw allow 26656/tcp  # P2P (if validator)
sudo ufw enable
```

2. **Key Security**
```bash
# Secure key storage
chmod 600 ~/.midnight/config/keys.json

# Use hardware wallet for signing keys (validators)
# Configure HSM integration
```

3. **Regular Updates**
```bash
# Set up automatic security updates
sudo apt install unattended-upgrades
sudo dpkg-reconfigure unattended-upgrades
```

### Network Security

1. **Use TLS for RPC**
```toml
[rpc]
# Enable TLS
enable_tls = true
tls_cert = "/path/to/cert.pem"
tls_key = "/path/to/key.pem"
```

2. **Restrict RPC Access**
```toml
[rpc]
# Only allow localhost by default
allowed_origins = ["http://localhost:3000"]
```

---

## Production Deployment Checklist

Before going to production:

- [ ] **Hardware meets requirements**: 8+ cores, 16GB RAM, NVMe SSD
- [ ] **OS hardened**: Firewall configured, unnecessary services disabled
- [ ] **Node identity secured**: Keys stored safely, backups created
- [ ] **Monitoring active**: Prometheus, Grafana, alerting configured
- [ ] **Health checks working**: `/health` endpoint returns 200
- [ ] **Logs rotating**: Log rotation configured
- [ ] **Backups scheduled**: Database and config backups automated
- [ ] **Update procedure documented**: Runbook for updates created
- [ ] **Recovery tested**: Backup/restore tested in staging
- [ ] **Security audited**: Port scan, vulnerability scan completed

---

## Conclusion

Running a Midnight node is more complex than traditional blockchain nodes, but the additional capabilities—ZK proof generation, selective disclosure, and privacy-preserving computation—make it worth the effort.

The key takeaways from this guide:

1. **Understand the components**: Node, proof server, indexer all work together
2. **Use Docker for easy deployment**: docker-compose.yml simplifies management
3. **Monitor proactively**: Set up alerts before issues become problems
4. **Plan for maintenance**: Regular backups and update procedures are essential
5. **Security is critical**: Protect your keys and restrict network access

By following this guide, you now have a fully operational Midnight node contributing to the network's security and decentralization.

---

*This tutorial covers the implementation for Midnight Bounty #432. For additional resources and troubleshooting, visit the Midnight documentation at docs.midnight.network.*
