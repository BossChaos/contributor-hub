---
title: "Proof Server and Indexer: How Midnight Processes Transactions"
---

# Proof Server and Indexer: How Midnight Processes Transactions

Every privacy-preserving blockchain faces the same fundamental challenge: how do you prove a transaction is valid without revealing its contents? Midnight solves this with zero-knowledge (ZK) proofs, but generating and verifying these proofs requires specialized infrastructure.

This is where the **Proof Server** comes in — the backbone of Midnight's transaction processing pipeline. In this tutorial, we'll explore the Proof Server architecture, understand how transactions flow through the system, set up a local proof server with Docker, and learn how to verify its health.

## The Midnight Transaction Pipeline

When a user submits a transaction on Midnight, it passes through several stages:

```
+------------------+    +------------------+    +----------------------+
|   Client/dApp    |--> |  Proof Server    |--> |     Indexer          |
|                  |    |  /check+prove    |    |  (State tracking)    |
+------------------+    +------------------+    +----------------------+
        |                                            |
        |         +------------------+    +----------+--+
        +-------->|   Cardano        |<---|   Block      |
                  |   Network        |    |   Producer   |
                  +------------------+    +-------------+
```

Let's break down each component.

## 1. The Proof Server

The Proof Server is an HTTP service that handles ZK proof generation and verification. It exposes two main endpoints:

### `/check` — Proof Verification

The `/check` endpoint validates whether a given proof is correct:

```
POST /check
Content-Type: application/json

{
    "proof": "<base64-encoded-proof>",
    "public_inputs": [...],
    "verification_key": "<vk-identifier>"
}

Response:
{
    "valid": true,
    "message": "Proof verified successfully"
}
```

The check is fast because it only verifies the cryptographic proof — it does not need to generate anything.

### `/prove` — Proof Generation

The `/prove` endpoint generates a new ZK proof from witness data:

```
POST /prove
Content-Type: application/json

{
    "circuit": "transfer-shielded",
    "witness": {
        "sender_commitment": "...",
        "recipient_nullifier": "...",
        "amount": "100",
        "private_key": "..."
    }
}

Response:
{
    "proof": "<base64-encoded-proof>",
    "public_inputs": [...],
    "generation_time_ms": 1247
}
```

Proof generation is computationally intensive. The first call to `/prove` for a given circuit type will be slow because the proof server must download the ZK parameters (approximately 30MB) from the network.

## 2. The Indexer

The Indexer tracks the state of the Midnight blockchain and provides queryable views of on-chain data. It:

1. **Consumes blocks** from the Cardano network
2. **Extracts Midnight transactions** from each block
3. **Updates contract state** (balances, nullifiers, commitments)
4. **Provides API endpoints** for dApps to query state

The Indexer is essential because Midnight contracts do not expose their state directly — you query it through the Indexer, which maintains an up-to-date view of all contract states.

### Indexer Data Flow

```
Cardano Blocks --> Indexer --> State Database
                                    |
                                    v
                            +------------------+
                            | Query API          |
                            | GET /balances/:addr|
                            | GET /txs/:hash     |
                            | GET /contracts/:id |
                            +------------------+
```

## 3. Setting Up a Local Proof Server

### Prerequisites

- Docker 20.10 or later
- At least 4GB RAM (proof generation is memory-intensive)
- Stable internet connection (for downloading ZK parameters)

### Docker Setup

```bash
# Pull the latest proof server image
docker pull ghcr.io/midnight-ntwrk/proof-server:latest

# Run the proof server
docker run -d \
    --name midnight-proof-server \
    -p 9944:9944 \
    -e MIDNIGHT_NETWORK=mainnet \
    ghcr.io/midnight-ntwrk/proof-server:latest

# Wait for the initial parameter download (~30MB)
# You can monitor progress with:
docker logs -f midnight-proof-server
```

### Expected Log Output

```
[INFO] Starting proof server v0.5.0
[INFO] Network: mainnet
[INFO] Loading verification keys...
[INFO] Verification keys loaded: 47 circuits
[INFO] Server listening on 0.0.0.0:9944
[INFO] Health check endpoint available at /health
```

## 4. Verifying Proof Server Health

Once your proof server is running, verify it is healthy before submitting transactions:

```bash
# Health check
curl http://localhost:9944/health

# Expected response:
# {"status": "healthy", "circuits_loaded": 47, "uptime_seconds": 123}

# Test proof generation (dry run)
curl -X POST http://localhost:9944/prove \
    -H "Content-Type: application/json" \
    -d '{"circuit": "test", "witness": {}}'
```

### Common Health Check Results

| Response | Meaning | Action |
|----------|---------|--------|
| "status": "healthy" | All circuits loaded, ready to process | Proceed normally |
| "status": "loading" | Still downloading ZK parameters | Wait 1-2 minutes, retry |
| "status": "degraded" | Some circuits failed to load | Check docker logs for errors |
| Connection refused | Server not running | Restart Docker container |

## 5. Version Compatibility

A critical issue: **the Proof Server Docker tag must match your Midnight ledger version**. Mismatched versions cause proof rejection due to wire format changes.

```bash
# Check your Midnight SDK version
npm list @midnight-ntwrk/sdk

# Match the proof server Docker tag to the SDK major version
# SDK v0.5.x -> proof-server:0.5.0
# SDK v0.4.x -> proof-server:0.4.0
docker pull ghcr.io/midnight-ntwrk/proof-server:0.5.0
```

### How to Detect Version Mismatch

If you see errors like:

```
ProofRejectionError: wire format mismatch — expected version 5, got 4
```

This means your proof server and SDK versions are out of sync. Fix by pulling the matching Docker tag.

## 6. Indexer Setup

The Indexer runs alongside the Proof Server and provides state queries:

```bash
# Run the indexer
docker run -d \
    --name midnight-indexer \
    -p 9945:9945 \
    -e MIDNIGHT_NETWORK=mainnet \
    -e PROOF_SERVER_URL=http://localhost:9944 \
    ghcr.io/midnight-ntwrk/indexer:latest

# Verify indexer is syncing
curl http://localhost:9945/status

# Expected:
# {"synced": true, "latest_block": 1234567, "contracts_indexed": 89}
```

## 7. End-to-End Transaction Flow

Let's trace a complete transaction through the pipeline:

1. **User submits transaction** from dApp via `midnight-cli` or SDK
2. **SDK calls `/prove`** on the Proof Server to generate ZK proof
3. **Proof Server generates proof** (downloads params if first call)
4. **SDK submits transaction + proof** to the Cardano network
5. **Block Producer includes transaction** in a block
6. **Indexer consumes the block** and updates contract state
7. **dApp queries Indexer** to confirm transaction result

**Timeline:**
- 0ms: SDK constructs transaction
- 10ms: SDK calls /prove
- 1200ms: Proof generated
- 1250ms: Transaction submitted to Cardano mempool
- ~30s: Transaction included in block
- ~60s: Indexer processes block, state updated
- ~65s: dApp can query updated state

## 8. Production Considerations

For production deployments:

- **Use a dedicated Proof Server** — Do not run it on the same machine as your dApp server
- **Monitor proof generation times** — Set up alerts for proofs taking over 30 seconds
- **Keep ZK parameters cached** — The 30MB download happens once per circuit type; persist the cache across restarts
- **Run multiple Indexer instances** — For high-traffic dApps, run read replicas
- **TLS termination** — Always run the Proof Server behind a reverse proxy with TLS in production

## Conclusion

The Proof Server and Indexer are the infrastructure that makes Midnight's privacy guarantees possible. Understanding their architecture helps you:

- **Debug transaction failures** — Know which component to check
- **Optimize dApp performance** — Understand proof generation costs
- **Deploy production infrastructure** — Set up reliable, version-matched services
- **Monitor system health** — Verify all components are operational
