# Midnight Proof Server Debugging Guide

A comprehensive tutorial for debugging Midnight proof server issues in production and development environments.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Proof Server Architecture](#proof-server-architecture)
3. [Debugging: Proof Server Not Responding](#debugging-proof-server-not-responding)
4. [Debugging: Proof Timeout](#debugging-proof-timeout)
5. [Debugging: Wire Format Mismatch](#debugging-wire-format-mismatch)
6. [Debugging: Version Mismatch](#debugging-version-mismatch)
7. [Proof Server Health Checks](#proof-server-health-checks)
8. [Common Error Codes](#common-error-codes)
9. [Best Practices](#best-practices)

---

## Introduction

Midnight is a privacy-focused blockchain platform that leverages zero-knowledge proofs (ZKPs) to enable confidential computations. The **proof system** is the backbone of Midnight's privacy guarantees — it allows parties to prove the validity of statements without revealing the underlying data.

**Why does proof server debugging matter?**

When developing on Midnight, you'll inevitably encounter issues with proof generation and verification. Unlike traditional application debugging, proof server issues can stem from:

- Network connectivity problems
- Large parameter downloads
- Version incompatibilities between components
- Wire format mismatches between client and server

This guide covers the most common proof server issues you'll face and provides actionable debugging techniques to resolve them quickly.

---

## Proof Server Architecture

Understanding how the proof server works helps you debug issues more effectively.

### Core Components

```
┌─────────────────┐       ┌──────────────────┐       ┌─────────────────┐
│  Client App     │──────▶│  Proof Server    │──────▶│  Ledger/Node    │
│  (Your Code)    │       │  (Docker Container)│       │  (Blockchain)   │
└─────────────────┘       └──────────────────┘       └─────────────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │  ZK Prover       │
                         │  (Heavy Compute) │
                         └──────────────────┘
```

### How Proof Generation Works

1. **Request**: Your application sends a proof request to the proof server via REST API
2. **Compilation**: The server compiles your circuit into a proof-friendly format
3. **Parameter Loading**: On first run, ~30MB of ZK proving parameters are downloaded
4. **Proof Generation**: The ZK prover generates the cryptographic proof
5. **Response**: The proof is returned to your application for submission

### Communication Protocol

The proof server uses a **wire format** for all requests and responses. This format defines how data is serialized and deserialized between client and server. Version mismatches in this protocol are a common source of errors.

---

## Debugging: Proof Server Not Responding

The most common issue is the proof server simply not responding to requests.

### Step 1: Check Docker Container Status

```bash
# List all proof server containers
docker ps -a | grep proof

# Check if container is running
docker ps | grep midnight-proof

# Inspect container details
docker inspect midnight-proof-server
```

### Step 2: Examine Docker Logs

```bash
# View recent logs
docker logs midnight-proof-server --tail 100

# Follow logs in real-time
docker logs -f midnight-proof-server

# Search for errors in logs
docker logs midnight-proof-server 2>&1 | grep -i error

# Get logs with timestamps
docker logs --timestamps midnight-proof-server --tail 200
```

**Common log messages and their meanings:**

| Log Message | Meaning | Resolution |
|-------------|---------|------------|
| `Connection refused` | Server not listening | Restart container |
| `Port already allocated` | Port conflict | Change port mapping |
| `Permission denied` | File system issue | Check volume permissions |
| `Out of memory` | Resource exhaustion | Increase memory limit |

### Step 3: Network Connectivity Check

```bash
# Test local connectivity
curl -v http://localhost:9090/health

# Check if port is listening
netstat -tlnp | grep 9090

# Verify Docker network
docker network inspect bridge
```

### Step 4: Container Resource Issues

```bash
# Check container resource usage
docker stats midnight-proof-server --no-stream

# Restart with resource adjustments
docker run -d \
  --name midnight-proof-server \
  --memory=4g \
  --cpus=2 \
  -p 9090:9090 \
  midnightntwrk/proof-server:latest
```

### Step 5: Health Endpoint Verification

```bash
# Basic health check
curl http://localhost:9090/health

# Detailed status check
curl http://localhost:9090/status

# Expected response format
{
  "status": "healthy",
  "version": "1.2.3",
  "uptime_seconds": 3600,
  "proof_queue_size": 0
}
```

---

## Debugging: Proof Timeout

Proof generation can be slow, especially on first run.

### Understanding the ~30MB ZK Parameter Download

On the **first proof generation**, the server must download approximately **30MB of Zero-Knowledge proving parameters** (also called "toxic waste" or ceremony artifacts). This is a one-time download per installation.

**Why it's slow:**
- Parameters are cryptographically large
- Download happens over HTTPS with integrity verification
- Decompression and indexing adds overhead

### Diagnosing Timeout Issues

**Check if parameters are downloaded:**

```bash
# View logs for parameter download progress
docker logs midnight-proof-server | grep -i "param"

# Check parameter storage (if using volume mount)
docker exec midnight-proof-server ls -la /app/params/
```

**Typical log output during first proof:**

```
[INFO] Downloading proving parameters (30.2 MB)...
[INFO] Download complete. Verifying integrity...
[INFO] Parameters cached at /app/params/proving.params
[INFO] Indexing parameters for faster lookups...
[INFO] Proof generation ready
```

### Timeout Configuration

```bash
# Set extended timeout for proof requests (in seconds)
export PROOF_TIMEOUT=300

# Or in docker-compose.yml
environment:
  - PROOF_TIMEOUT=300
  - PROOF_SERVER_PORT=9090
```

### Optimization Tips

1. **Pre-warm the server**: Generate a dummy proof on deployment to cache parameters
2. **Use local parameters**: Mount a persistent volume with pre-downloaded parameters
3. **Scale horizontally**: Deploy multiple proof servers behind a load balancer
4. **Enable caching**: Configure the server to cache compiled circuits

```yaml
# docker-compose.yml with optimization
services:
  proof-server:
    image: midnightntwrk/proof-server:latest
    volumes:
      - ./params:/app/params:ro  # Read-only parameter mount
    environment:
      - PROOF_TIMEOUT=300
      - CACHE_ENABLED=true
      - CACHE_SIZE_MB=512
```

---

## Debugging: Wire Format Mismatch

Proof requests and responses use a specific **wire format** for serialization. Version mismatches cause rejection.

### Symptoms

```
Error: Wire format mismatch
Expected: format_version=3
Received: format_version=2
```

### Diagnosis

**Check client and server versions:**

```bash
# Server version
curl http://localhost:9090/version

# Client version (if using CLI)
midnight-cli version
```

### Common Causes

1. **Outdated client library**: Your SDK is older than the server
2. **Mixed Docker tags**: Using `latest` on one side, pinned version on another
3. **Partial update**: Updated server but not client (or vice versa)

### Resolution

```bash
# Ensure matching versions
docker pull midnightntwrk/proof-server:v1.2.3
docker tag midnightntwrk/proof-server:v1.2.3 midnightntwrk/proof-server:latest

# Update client library
npm install @midnight/sdk@1.2.3
# or
pip install midnight-sdk==1.2.3
```

### Wire Format Debugging

Enable verbose logging to see exact wire format issues:

```bash
docker run -e LOG_LEVEL=DEBUG midnightntwrk/proof-server:latest
```

---

## Debugging: Version Mismatch

Version mismatches between the **proof server Docker tag** and the **ledger version** cause proof rejection.

### Understanding Version Dependencies

```
┌─────────────────────┐    ┌─────────────────────┐
│   Ledger Version    │    │  Proof Server Tag   │
│                     │    │                     │
│   v1.0.0            │───▶│   v1.0.0-compatible │
│   v1.1.0            │───▶│   v1.1.0-compatible │
│   v1.2.0            │───▶│   v1.2.0-compatible │
└─────────────────────┘    └─────────────────────┘
```

### Checking Versions

```bash
# Check ledger version
curl http://localhost:26657/status | jq .result.node_info.version

# Check proof server compatibility
curl http://localhost:9090/compatibility

# Response example
{
  "ledger_version": "1.2.0",
  "proof_server_version": "1.2.0",
  "compatible": true,
  "required_proof_version": "1.2.0"
}
```

### Docker Tag to Ledger Mapping

| Ledger Version | Docker Tag | Notes |
|----------------|------------|-------|
| 1.0.x | `v1.0.x` | Initial release |
| 1.1.x | `v1.1.x` | Added batch proofs |
| 1.2.x | `v1.2.x` | Performance improvements |
| 1.3.x | `v1.3.x` | New circuit version |

### Fixing Version Mismatch

```bash
# Stop current container
docker stop midnight-proof-server
docker rm midnight-proof-server

# Pull correct version
docker pull midnightntwrk/proof-server:1.2.0-compatible

# Start with correct tag
docker run -d \
  --name midnight-proof-server \
  -p 9090:9090 \
  midnightntwrk/proof-server:1.2.0-compatible
```

### Automated Version Checking

Add this to your deployment script:

```bash
#!/bin/bash
LEDGER_VERSION=$(curl -s http://localhost:26657/status | jq -r .result.node_info.version)
REQUIRED_TAG="${LEDGER_VERSION}-compatible"

CURRENT_TAG=$(docker inspect midnight-proof-server --format '{{.Config.Image}}')

if [[ "$CURRENT_TAG" != *"$REQUIRED_TAG"* ]]; then
    echo "Version mismatch! Pulling $REQUIRED_TAG..."
    docker pull midnightntwrk/proof-server:$REQUIRED_TAG
    # Restart with new version
fi
```

---

## Proof Server Health Checks

Regular health monitoring helps catch issues before they cause failures.

### Health Endpoint Reference

| Endpoint | Purpose | Auth Required |
|----------|---------|---------------|
| `GET /health` | Basic liveness check | No |
| `GET /status` | Detailed status | No |
| `GET /metrics` | Prometheus metrics | No |
| `GET /ready` | Readiness probe | No |

### Health Check Response Examples

**`/health` - Liveness**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**`/status` - Detailed Status**
```json
{
  "status": "healthy",
  "version": "1.2.0",
  "uptime_seconds": 86400,
  "proof_queue_size": 2,
  "average_proof_time_ms": 15000,
  "total_proofs_generated": 150,
  "parameters_cached": true,
  "memory_usage_mb": 2048,
  "cpu_usage_percent": 45.2
}
```

### Setting Up Monitoring

```bash
# Prometheus scrape config
scrape_configs:
  - job_name: 'midnight-proof-server'
    static_configs:
      - targets: ['proof-server:9090']
    metrics_path: '/metrics'
```

### Alerting Rules

```yaml
groups:
  - name: midnight-proof-server
    rules:
      - alert: ProofServerDown
        expr: up{job="midnight-proof-server"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Proof server is down"
          
      - alert: ProofQueueBacklog
        expr: proof_queue_size > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Proof queue backlog detected"
```

---

## Common Error Codes

### Error 1010: Cloudflare-style Error (Misleading)

**Actually caused by:** Server returning malformed response

```bash
# Check server logs
docker logs midnight-proof-server | tail -50

# Common fix: Restart server with correct CORS settings
docker run -e CORS_ENABLED=true midnightntwrk/proof-server:latest
```

### Error 1020: Access Denied

```json
{
  "error": 1020,
  "message": "Access denied - invalid API key",
  "resolution": "Check PROOF_API_KEY environment variable"
}
```

### Error 2001: Proof Generation Timeout

```json
{
  "error": 2001,
  "message": "Proof generation timed out after 300 seconds",
  "causes": ["Network latency", "High server load", "Large circuit"],
  "resolution": "Increase PROOF_TIMEOUT or scale horizontally"
}
```

### Error 2002: Proof Verification Failed

```json
{
  "error": 2002,
  "message": "Proof verification failed on ledger",
  "causes": ["Circuit version mismatch", "Corrupted proof", "State inconsistency"],
  "resolution": "Regenerate proof with current state"
}
```

### Error 3001: Wire Format Error

```json
{
  "error": 3001,
  "message": "Wire format version mismatch",
  "expected": "3",
  "received": "2",
  "resolution": "Update client SDK to latest version"
}
```

### Error 3002: Serialization Error

```json
{
  "error": 3002,
  "message": "Failed to deserialize request",
  "field": "transaction",
  "resolution": "Check request payload format"
}
```

### Error 4001: Version Incompatibility

```json
{
  "error": 4001,
  "message": "Proof server version incompatible with ledger",
  "server_version": "1.1.0",
  "required_version": "1.2.0",
  "resolution": "Update proof server to v1.2.0"
}
```

---

## Best Practices

### 1. Always Pin Versions in Production

```yaml
# ❌ Bad: Using 'latest'
image: midnightntwrk/proof-server:latest

# ✅ Good: Pinning exact version
image: midnightntwrk/proof-server:1.2.0-compatible
```

### 2. Pre-warm on Deployment

```bash
#!/bin/bash
# Warm up proof server before traffic
curl -X POST http://localhost:9090/warmup \
  -H "Content-Type: application/json" \
  -d '{"circuits": ["default"]}'
```

### 3. Implement Retry Logic

```javascript
async function generateProofWithRetry(request, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await proofServer.generateProof(request);
    } catch (error) {
      if (error.code === 2001 && i < maxRetries - 1) {
        await sleep(1000 * Math.pow(2, i)); // Exponential backoff
        continue;
      }
      throw error;
    }
  }
}
```

### 4. Monitor Key Metrics

- **Proof generation time**: Spikes indicate server overload
- **Queue size**: Growing queue means scaling needed
- **Error rate**: Sudden increases indicate version mismatch
- **Cache hit rate**: Low rates suggest parameter issues

### 5. Keep Logs Accessible

```bash
# Aggregate logs to centralized system
docker logs -f midnight-proof-server | jq -r 'select(.level == "error")' > /var/log/proof-errors.log
```

---

## Summary

Debugging Midnight proof servers requires understanding:

1. **Docker container management** - Always check container status and logs first
2. **Network diagnostics** - Verify connectivity and port bindings
3. **Version alignment** - Keep client SDK, proof server, and ledger in sync
4. **Resource management** - Provide adequate memory and CPU for ZK operations
5. **Health monitoring** - Implement regular health checks and alerting

When encountering issues, follow this diagnostic order:
1. Check `docker logs` for errors
2. Verify health endpoint responds
3. Confirm version compatibility
4. Review wire format consistency
5. Check resource utilization

For additional support, consult the [Midnight documentation](https://docs.midnight.network) or reach out on the [Midnight Discord](https://discord.gg/midnight).

---

*Last updated: January 2024 | Compatible with Midnight SDK v1.2.x*
