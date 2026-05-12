---
title: "Integrating Midnight Proofs into an Existing Backend (Node.js/REST)"
published: true
tags: ["midnight", "blockchain", "zeroknowledge", "nodejs", "restapi", "backend"]
cover_image: ""
---

# Integrating Midnight Proofs into an Existing Backend (Node.js/REST)

Your backend already handles authentication, business logic, and database operations. Now you need to add zero-knowledge proof generation and Midnight blockchain transactions to the mix.

This is where things get interesting — and where most developers get stuck.

The Midnight SDK was designed with browsers in mind, but running it on a server introduces different challenges: persistent state, proof server connectivity, ZK artifact management, and handling long-running proof generation without blocking your API.

I'll walk you through setting up `httpClientProofProvider` in a Node.js/Express backend, from provider assembly to production-ready error handling.

## Why Run Proofs on the Server?

Three scenarios where server-side proof generation makes sense:

1. **Backend-as-a-Service**: Your users don't run a wallet. You generate proofs on their behalf (with appropriate key management).
2. **Automated Workflows**: Scheduled tasks that need to interact with Midnight contracts — rebalancing, reporting, batch operations.
3. **Hybrid Architecture**: Browser dApp for user interaction, backend for heavy proof generation and transaction batching.

The key insight: **the same Midnight.js provider stack works in both environments.** You just swap out browser-specific providers for Node.js equivalents.

## Provider Architecture

Midnight.js uses a modular provider pattern. Every capability is a pluggable interface:

```
MidnightProviders
├── privateStateProvider    — Encrypted local state (LevelDB on server)
├── publicDataProvider      — GraphQL blockchain queries
├── zkConfigProvider        — ZK artifact retrieval (prover/verifier keys)
├── proofProvider           — Zero-knowledge proof generation
├── walletProvider          — Transaction balancing and signing
├── midnightProvider        — Transaction submission
└── loggerProvider          — Diagnostics logging
```

For a server deployment, the critical swap is:
- **Browser**: `FetchZkConfigProvider` (HTTP fetch)
- **Server**: `NodeZkConfigProvider` (filesystem)
- **Both**: `httpClientProofProvider` (HTTP to proof server)

## Prerequisites

Before we start, you'll need:

- Node.js 20+ LTS installed
- A running Midnight proof server (local or remote)
- Access to a Midnight node RPC endpoint
- A wallet with testnet tokens for gas

Set up your project:

```bash
mkdir midnight-rest-api && cd midnight-rest-api
npm init -y

# Core Midnight packages
npm install @midnight-ntwrk/midnight-js-contracts \
  @midnight-ntwrk/midnight-js-http-client-proof-provider \
  @midnight-ntwrk/midnight-js-node-zk-config-provider \
  @midnight-ntwrk/midnight-js-level-private-state-provider \
  @midnight-ntwrk/midnight-js-indexer-public-data-provider \
  @midnight-ntwrk/midnight-js-network-id \
  @midnight-ntwrk/midnight-js-logger-provider

# Web framework
npm install express cors dotenv
npm install -D typescript @types/node @types/express
```

## Step 1: Configure the Network

Every Midnight SDK call needs to know which network it's targeting:

```typescript
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

// Choose your environment
setNetworkId('testnet');
// setNetworkId('preprod');
// setNetworkId('mainnet');
```

This configures the underlying WASM runtime and ledger APIs. **Set this before initializing any providers.**

## Step 2: Assemble the Provider Stack

Here's where the server-specific configuration happens:

```typescript
import { LevelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';

// ZK artifacts stored locally on the server
const zkConfigProvider = new NodeZkConfigProvider(
  '/var/midnight/zk-artifacts'
);

// Encrypted private state with LevelDB
const privateStateProvider = new LevelPrivateStateProvider({
  privateStoragePasswordProvider: async () => process.env.STATE_PASSWORD!,
  accountId: walletAddress,
});

// GraphQL public data provider
const publicDataProvider = indexerPublicDataProvider(
  process.env.INDEXER_QUERY_URL!,
  process.env.INDEXER_SUBSCRIPTION_URL!
);

// The proof provider — connects to your proof server
const proofProvider = httpClientProofProvider(
  process.env.PROOF_SERVER_URL!,  // e.g., 'http://localhost:9945'
  zkConfigProvider
);
```

The `httpClientProofProvider` is the bridge between your backend and the proof server. It takes a URL and a ZK config provider, then handles the HTTP communication for proof generation requests.

**Important**: The proof server must be running before you initialize this provider. If it's not, you'll get connection refused errors at proof generation time, not at initialization.

## Step 3: Build the Express REST API

Now let's wrap Midnight contract interactions in REST endpoints:

```typescript
import express, { Request, Response } from 'express';
import cors from 'cors';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';

const app = express();
app.use(cors());
app.use(express.json());

// Store deployed contract references
const contracts = new Map<string, any>();

// ─── Deploy a Contract ───

app.post('/api/contracts/deploy', async (req: Request, res: Response) => {
  try {
    const { compiledContract, privateStateId, initialPrivateState } = req.body;

    const deployed = await deployContract(providers, {
      compiledContract,
      privateStateId,
      initialPrivateState,
    });

    contracts.set(privateStateId, deployed);

    res.json({
      success: true,
      contractAddress: deployed.contractAddress,
      privateStateId,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ─── Call a Contract Circuit ───

app.post('/api/contracts/:privateStateId/call', async (req: Request, res: Response) => {
  try {
    const { privateStateId } = req.params;
    const { circuitName, args } = req.body;

    const deployed = contracts.get(privateStateId);
    if (!deployed) {
      return res.status(404).json({
        success: false,
        error: `Contract ${privateStateId} not found`,
      });
    }

    const result = await deployed.callTx[circuitName](...args);

    res.json({
      success: true,
      transactionHash: result.transactionHash,
      status: result.status,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ─── Query Contract State ───

app.get('/api/contracts/:privateStateId/state', async (req: Request, res: Response) => {
  try {
    const { privateStateId } = req.params;
    const deployed = contracts.get(privateStateId);

    if (!deployed) {
      return res.status(404).json({
        success: false,
        error: `Contract ${privateStateId} not found`,
      });
    }

    const state = await deployed.getPrivateState();
    res.json({ success: true, state });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Midnight REST API listening on port ${PORT}`);
});
```

## Step 4: Handle Proof Timeouts and Network Failures

This is where production deployments live or die. Proof generation can take seconds to minutes, and network connections can fail at any point.

### Timeout Wrapper for Proof Generation

```typescript
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(
      new Error(`${operation} timed out after ${timeoutMs}ms`)
    ), timeoutMs);
  });

  return Promise.race([promise, timeout]);
}

// Usage in contract call
app.post('/api/contracts/:privateStateId/call', async (req, res) => {
  try {
    const result = await withTimeout(
      deployed.callTx[circuitName](...args),
      120_000, // 2 minute timeout for proof generation
      'Proof generation'
    );

    res.json({ success: true, transactionHash: result.transactionHash });
  } catch (error) {
    if (error instanceof Error && error.message.includes('timed out')) {
      return res.status(408).json({
        success: false,
        error: 'Proof generation timed out. The proof server may be overloaded.',
      });
    }
    // Handle other errors...
  }
});
```

### Retry Logic for Network Failures

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on certain errors
      if (lastError.message.includes('invalid') ||
          lastError.message.includes('unauthorized')) {
        throw lastError;
      }

      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError!;
}

// Usage for transaction submission
const result = await withRetry(
  () => deployed.callTx[circuitName](...args),
  3,
  2000
);
```

### Health Check Endpoint

```typescript
app.get('/api/health', async (req: Request, res: Response) => {
  const health = {
    status: 'ok',
    proofServer: false,
    nodeRpc: false,
    indexer: false,
  };

  try {
    // Check proof server
    await fetch(process.env.PROOF_SERVER_URL! + '/health', {
      signal: AbortSignal.timeout(5000),
    });
    health.proofServer = true;
  } catch {
    health.status = 'degraded';
  }

  // Check node RPC
  try {
    const response = await fetch(process.env.NODE_RPC_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'system_health',
        params: [],
        id: 1,
      }),
      signal: AbortSignal.timeout(5000),
    });
    health.nodeRpc = response.ok;
  } catch {
    health.status = 'degraded';
  }

  res.json(health);
});
```

## Step 5: Environment Configuration

Production deployments need proper environment variables:

```bash
# .env
NETWORK=testnet
PORT=3000

# Proof server
PROOF_SERVER_URL=http://localhost:9945

# Midnight node RPC
NODE_RPC_URL=http://localhost:9944
INDEXER_QUERY_URL=http://localhost:9944/graphql
INDEXER_SUBSCRIPTION_URL=ws://localhost:9944/graphql/ws

# ZK artifacts path
ZK_ARTIFACTS_PATH=/var/midnight/zk-artifacts

# Private state encryption
STATE_PASSWORD=your-secure-password-here

# Wallet configuration
WALLET_SEED=your-wallet-seed-phrase
```

## Error Handling Summary

| Error Type | Cause | Response |
|------------|-------|----------|
| `ECONNREFUSED` | Proof server not running | 503 Service Unavailable |
| `ETIMEDOUT` | Proof generation too slow | 408 Request Timeout |
| `InvalidProof` | Circuit execution failed | 400 Bad Request |
| `InsufficientFunds` | Not enough gas tokens | 402 Payment Required |
| `NetworkError` | Node RPC unreachable | 503 Service Unavailable |

## Next Steps

Once your REST API is running, you can:

1. **Add authentication**: API keys, JWT tokens, or OAuth for protected endpoints
2. **Implement webhooks**: Notify clients when long-running proofs complete
3. **Add rate limiting**: Prevent abuse of proof generation endpoints
4. **Set up monitoring**: Prometheus metrics for proof latency, success rates, and queue depth
5. **Containerize**: Package everything in Docker for consistent deployments

The Midnight SDK's provider architecture makes this straightforward — swap providers, keep the same contract interaction code, and you're running in production.

## Real-World Architecture

Here's how this looks in a production deployment:

```
                    ┌─────────────────┐
                    │   React dApp    │  (Browser)
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   Express API   │  (Node.js Backend)
                    │  :3000          │
                    └────┬─────┬─────┘
                         │     │
              ┌──────────▼┐   ┌▼──────────────┐
              │ Proof     │   │ Midnight Node │
              │ Server    │   │ RPC :9944     │
              │ :9945     │   │               │
              └───────────┘   └───────────────┘
```

The backend handles proof generation asynchronously, freeing the browser from heavy ZK computation. Users get fast responses, and your server manages the proof queue.

---

*Deployed on a Midnight node running on Alibaba Cloud ECS. All examples tested with Midnight.js v4.0.4.*
