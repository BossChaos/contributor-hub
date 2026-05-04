# Proof Server and Indexer: How Midnight Processes Transactions

> **Bounty #308** — Midnight Developer Tutorial  
> *Tier 2 (Medium) · $500–$700 in NIGHT tokens*

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Architecture Overview](#2-architecture-overview)
3. [Setting Up the Proof Server Locally](#3-setting-up-the-proof-server-locally)
4. [Version Compatibility: Docker Tags and Ledger Versions](#4-version-compatibility-docker-tags-and-ledger-versions)
5. [The Indexer: GraphQL Queries for On-Chain Data](#5-the-indexer-graphql-queries-for-on-chain-data)
6. [Real-Time Updates with WebSocket Subscriptions](#6-real-time-updates-with-websocket-subscriptions)
7. [SDK Abstraction: indexerPublicDataProvider vs Raw GraphQL](#7-sdk-abstraction-indexerpublicdataprovider-vs-raw-graphql)
8. [Putting It All Together: A Complete Example](#8-putting-it-all-together-a-complete-example)
9. [Troubleshooting Common Issues](#9-troubleshooting-common-issues)

---

## 1. Introduction

If you've spent time building on Midnight — the zero-knowledge privacy blockchain built with the Compact language — you've encountered two critical pieces of infrastructure between your smart contracts and the chain: the **Proof Server** and the **Indexer**.

- **The Proof Server** generates every zero-knowledge proof your contract needs. If you're building a private voting system, confidential token, or any application leveraging Midnight's privacy guarantees, the proof server is your computational workhorse.

- **The Indexer** is your window into the blockchain. Rather than scanning every block manually, it pre-processes chain data and serves it through a clean GraphQL API with WebSocket subscriptions for real-time updates.

This tutorial walks through both components: running them locally with Docker, querying them effectively, and deciding between the SDK abstraction (`indexerPublicDataProvider`) and direct GraphQL access.

---

## 2. Architecture Overview

The proof server and indexer serve distinct roles in the Midnight stack:

- **Proof Server ↔ Ledger**: The proof server doesn't interact with the ledger directly. Your application sends circuit inputs to the proof server, which computes a ZK proof. You then submit that proof (along with public inputs) to the ledger via a transaction.

- **Indexer ↔ Ledger**: The indexer passively consumes block data from a Midnight node, parsing transactions, contract state changes, and emitted events. It stores this in an internal database (typically PostgreSQL) and serves it through a GraphQL API.

- **Your dApp ↔ Both**: Your application talks to the proof server for proof generation and to the indexer for reading on-chain data. The `indexerPublicDataProvider` SDK wrapper provides typed access to the indexer with less boilerplate.

Understanding these boundaries tells you where failures happen. If proof generation fails, check the proof server or your circuit inputs. If data queries return stale results, investigate the indexer.

---

## 3. Setting Up the Proof Server Locally

The proof server runs as a Docker container — by design, since ZK proof generation is computationally intensive and benefits from a controlled, reproducible environment.

### Prerequisites

- Docker 20.10+ and Docker Compose v2
- At least 8 GB RAM (16 GB recommended for larger circuits)
- Midnight SDK installed (`npm install @midnight-ntwrk/sdk`)

### Single Container Setup

```bash
docker run -d \
  --name midnight-proof-server \
  -p 3001:3001 \
  -e PROOF_SERVER_LOG_LEVEL=info \
  ghcr.io/midnight-ntwrk/proof-server:v1.3.0
```

This maps port 3001 on your host to port 3001 in the container. Set `PROOF_SERVER_LOG_LEVEL=debug` for troubleshooting.

### Docker Compose for Development

For most development workflows, use a `docker-compose.yml` that includes the proof server alongside the indexer and its database:

```yaml
services:
  proof-server:
    image: ghcr.io/midnight-ntwrk/proof-server:v1.3.0
    container_name: midnight-proof-server
    ports:
      - "3001:3001"
    environment:
      PROOF_SERVER_LOG_LEVEL: debug
      PROOF_SERVER_MAX_CONCURRENT_PROOFS: 2
    healthcheck:
      test: ["CMD-SHELL", "curl -fs http://localhost:3001/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 3

  indexer:
    image: ghcr.io/midnight-ntwrk/indexer:v1.3.0
    container_name: midnight-indexer
    ports:
      - "4000:4000"
    environment:
      INDEXER_LEDGER_URL: http://ledger-node:9944
      INDEXER_GRAPHQL_PORT: 4000
      INDEXER_DATABASE_URL: postgresql://postgres:postgres@db:5432/indexer
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:15-alpine
    container_name: midnight-indexer-db
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: indexer
    ports:
      - "5432:5432"
    volumes:
      - indexer-db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  indexer-db-data:
```

Start everything with `docker compose up -d`.

### Verifying the Proof Server

```bash
curl http://localhost:3001/health
```

Expected response:

```json
{
  "status": "ok",
  "version": "1.3.0",
  "uptime_seconds": 42
}
```

### Generating Your First Proof

```typescript
import { ProofServerClient } from "@midnight-ntwrk/sdk";

const proofClient = new ProofServerClient("http://localhost:3001");

const circuitInputs = {
  secretKey: "0x1a2b3c4d...",
  publicValue: 100,
  merkleRoot: "0xdeadbeef...",
};

const proof = await proofClient.generateProof({
  circuitName: "transfer",
  inputs: circuitInputs,
});

console.log(`Proof generated: ${proof.proofId}`);
```

The proof server handles witness generation, constraint checking, and proof computation internally. You get back a proof object ready for on-chain verification along with the public inputs for your transaction.

**Performance note**: Proof generation time depends on circuit complexity. Simple circuits take a few seconds; more complex ones can take 30+ seconds. The `PROOF_SERVER_MAX_CONCURRENT_PROOFS` environment variable controls concurrent proof generation — the default is typically 1 or 2 to avoid memory pressure.

---

## 4. Version Compatibility: Docker Tags and Ledger Versions

This is one of the most common sources of confusion for new Midnight developers: **the Docker tag for the proof server and indexer must match your ledger version**.

### Why Version Matching Matters

ZK circuits are compiled against specific constraint systems and proving key formats. The ledger's consensus rules, transaction format, and event schema also evolve between versions. Mismatched versions cause:

- **Proof rejection**: Proofs generated by an older proving key format won't be accepted by a newer ledger.
- **Schema mismatches**: The indexer may emit events in a format your SDK doesn't expect.
- **Silent failures**: Things appear to work but produce incorrect results due to subtle constraint changes.

### Matching Versions

Use the same tag for all Docker images as your ledger version:

```yaml
services:
  proof-server:
    image: ghcr.io/midnight-ntwrk/proof-server:v1.3.0  # ← matches ledger v1.3.0

  indexer:
    image: ghcr.io/midnight-ntwrk/indexer:v1.3.0       # ← matches ledger v1.3.0
```

### Checking Your Ledger Version

Query the node directly:

```bash
curl -X POST http://ledger-node:9944 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"system_version","params":[],"id":1}'
```

Or check the ledger node container logs (the ledger runs as a separate service from the compose stack above):

```bash
docker logs <your-ledger-container> 2>&1 | grep -i version
```

### Using Environment Variables for Consistency

In CI/CD or team environments, define the version once:

```yaml
x-common: &common
  LEDGER_VERSION: "v1.3.0"

services:
  proof-server:
    image: ghcr.io/midnight-ntwrk/proof-server:${LEDGER_VERSION:-v1.3.0}
  indexer:
    image: ghcr.io/midnight-ntwrk/indexer:${LEDGER_VERSION:-v1.3.0}
```

Always test your full stack after a version bump.

---

## 5. The Indexer: GraphQL Queries for On-Chain Data

The Midnight indexer exposes a GraphQL API for querying transactions, contract state, events, and more. Access the GraphQL playground at `http://localhost:4000/graphql` to explore the schema interactively.

```bash
npm install graphql-request graphql
```

### Querying Transactions

```typescript
import { GraphQLClient } from "graphql-request";

const indexer = new GraphQLClient("http://localhost:4000/graphql");

interface TransactionNode {
  id: string;
  hash: string;
  blockHeight: number;
  status: "INCLUDED" | "PENDING" | "FAILED";
  contractAddress: string | null;
  timestamp: string;
}

const result = await indexer.request<{
  transactions: { edges: Array<{ node: TransactionNode }> };
}>(
  `query RecentTransactions($limit: Int!) {
    transactions(first: $limit, orderBy: BLOCK_HEIGHT_DESC) {
      edges {
        node { id, hash, blockHeight, status, contractAddress, timestamp }
      }
    }
  }`,
  { limit: 10 }
);

result.transactions.edges.forEach(({ node }) => {
  console.log(`[${node.blockHeight}] ${node.hash.slice(0, 10)}... → ${node.status}`);
});
```

### Querying Contract State

```typescript
const contractState = await indexer.request<{
  contract: {
    address: string;
    name: string;
    state: Array<{ key: string; value: string }>;
    lastUpdatedBlock: number;
  };
}>(
  `query ContractState($address: String!) {
    contract(address: $address) {
      address, name, state { key, value }, lastUpdatedBlock
    }
  }`,
  { address: "0x1234abcd..." }
);

contractState.contract.state.forEach(({ key, value }) => {
  console.log(`  ${key}: ${value}`);
});
```

### Querying Events

```typescript
const events = await indexer.request<{
  events: { edges: Array<{ node: { eventType: string; data: string; blockHeight: number; transactionHash: string } }> };
}>(
  `query ContractEvents($address: String!, $limit: Int!) {
    events(contractAddress: $address, first: $limit, orderBy: BLOCK_HEIGHT_DESC) {
      edges { node { eventType, data, blockHeight, transactionHash } }
    }
  }`,
  { address: "0x1234abcd...", limit: 50 }
);

events.events.edges.forEach(({ node }) => {
  const eventData = JSON.parse(node.data);
  console.log(`Event ${node.eventType} at block ${node.blockHeight}:`, eventData);
});
```

### Cursor-Based Pagination

The indexer uses Relay-style cursor pagination. Always check `pageInfo.hasNextPage` and use the `endCursor` as the `after` parameter:

```typescript
async function fetchAllTransactions(indexer: GraphQLClient) {
  let allTransactions: TransactionNode[] = [];
  let cursor: string | undefined;

  while (true) {
    const result = await indexer.request(
      `query($limit: Int!, $after: String) {
        transactions(first: $limit, after: $after, orderBy: BLOCK_HEIGHT_DESC) {
          edges { node { id, hash, blockHeight, status, contractAddress, timestamp } }
          pageInfo { hasNextPage, endCursor }
        }
      }`,
      { limit: 100, after: cursor }
    );

    allTransactions = allTransactions.concat(result.transactions.edges.map((e) => e.node));
    if (!result.transactions.pageInfo.hasNextPage) break;
    cursor = result.transactions.pageInfo.endCursor;
  }

  return allTransactions;
}
```

---

## 6. Real-Time Updates with WebSocket Subscriptions

For dApps that need to react to on-chain events immediately, the indexer supports GraphQL subscriptions over WebSocket.

```bash
npm install graphql-ws graphql
```

### Setting Up the WebSocket Client

```typescript
import { createClient } from "graphql-ws";

const wsClient = createClient({
  url: "ws://localhost:4000/graphql",
  retryAttempts: 5,
  shouldRetry: (err) => {
    console.error("WebSocket error, reconnecting...", err);
    return true;
  },
});
```

### Subscribing to New Blocks

```typescript
import { subscribe } from "graphql-ws";
import { parse } from "graphql";

const blockStream = subscribe(wsClient, {
  query: `subscription OnNewBlock {
    newBlock { height, hash, timestamp, transactionCount }
  }`,
});

for await (const event of blockStream) {
  const { newBlock } = event as { newBlock: { height: number; hash: string } };
  console.log(`New block #${newBlock.height}: ${newBlock.hash.slice(0, 10)}...`);
}
```

### Subscribing to Contract Events

```typescript
const eventStream = subscribe(wsClient, {
  query: `subscription OnContractEvent($address: String!) {
    eventEmitted(contractAddress: $address) {
      eventType, data, blockHeight, transactionHash
    }
  }`,
  variables: { address: "0x1234abcd..." },
});

for await (const event of eventStream) {
  const { eventEmitted } = event as {
    eventEmitted: { eventType: string; data: string; blockHeight: number };
  };

  switch (eventEmitted.eventType) {
    case "Transfer":
      const transferData = JSON.parse(eventEmitted.data);
      console.log(`Transfer: ${transferData.from} → ${transferData.to} (${transferData.amount})`);
      break;
    case "Approval":
      console.log("New approval event received");
      break;
  }
}
```

### Subscribing to Transaction Status

```typescript
function waitForTransaction(txHash: string): Promise<{ status: string; blockHeight?: number }> {
  return new Promise((resolve, reject) => {
    const stream = subscribe(wsClient, {
      query: `subscription OnTxStatus($hash: String!) {
        transactionStatusChanged(hash: $hash) { status, blockHeight, failureReason }
      }`,
      variables: { hash: txHash },
    });

    (async () => {
      for await (const event of stream) {
        const { transactionStatusChanged } = event as {
          transactionStatusChanged: { status: string; blockHeight?: number; failureReason?: string };
        };

        if (transactionStatusChanged.status === "INCLUDED") {
          resolve({ status: "INCLUDED", blockHeight: transactionStatusChanged.blockHeight });
          break;
        } else if (transactionStatusChanged.status === "FAILED") {
          reject(new Error(`Transaction failed: ${transactionStatusChanged.failureReason}`));
          break;
        }
      }
    })();
  });
}
```

### Managing Subscriptions

Clean up subscriptions when your component unmounts or the app shuts down:

```typescript
process.on("SIGINT", () => wsClient.dispose());
process.on("SIGTERM", () => wsClient.dispose());
```

---

## 7. SDK Abstraction: indexerPublicDataProvider vs Raw GraphQL

The Midnight SDK provides `indexerPublicDataProvider` — a typed abstraction over the indexer's GraphQL API. Knowing when to use this versus raw GraphQL is important for building maintainable dApps.

### What is indexerPublicDataProvider?

The data provider wraps the indexer's GraphQL API with:

- **Typed responses**: No need to manually define TypeScript interfaces.
- **Built-in pagination**: Handles cursor-based pagination automatically.
- **Connection management**: Manages WebSocket reconnections and HTTP retries.
- **Caching**: Optional caching layer for frequently accessed data.

### Using indexerPublicDataProvider

```typescript
import { indexerPublicDataProvider, MidnightProvider } from "@midnight-ntwrk/sdk";

const provider = new MidnightProvider({
  indexerUrl: "http://localhost:4000/graphql",
  indexerWsUrl: "ws://localhost:4000/graphql",
});

const dataProvider = indexerPublicDataProvider(provider);

// Fetch transactions — fully typed, no GraphQL boilerplate
const transactions = await dataProvider.getTransactions({
  limit: 20,
  orderBy: "BLOCK_HEIGHT_DESC",
});

for (const tx of transactions) {
  console.log(`[${tx.blockHeight}] ${tx.hash.slice(0, 10)}... → ${tx.status}`);
}

// Get contract state
const contractState = await dataProvider.getContractState("0x1234abcd...");

// Subscribe to events — returns an async iterator
const eventStream = dataProvider.subscribeToEvents({
  contractAddress: "0x1234abcd...",
});

for await (const event of eventStream) {
  console.log(`Event: ${event.type}`, event.data);
}
```

### When to Use Each Approach

**Use `indexerPublicDataProvider` when:**
- Building a standard dApp needing common queries (transactions, events, contract state).
- You want type safety without writing GraphQL queries manually.
- You need subscriptions with automatic reconnection handling.
- You're iterating quickly and don't want to craft custom GraphQL.

**Use raw GraphQL when:**
- You need complex queries the SDK doesn't support (aggregations, nested filters, custom ordering).
- You want to minimize bundle size and don't need the full SDK.
- You're building a specialized tool (explorer, analytics dashboard).
- You need to batch multiple queries into a single request.

### Combining Both Approaches

Most production dApps use both. The SDK handles common cases; direct GraphQL fills in the gaps:

```typescript
class MyDAppDataLayer {
  private dataProvider: ReturnType<typeof indexerPublicDataProvider>;
  private graphqlClient: GraphQLClient;

  constructor(provider: MidnightProvider) {
    this.dataProvider = indexerPublicDataProvider(provider);
    this.graphqlClient = new GraphQLClient("http://localhost:4000/graphql");
  }

  // Common query — use SDK
  async getRecentEvents(contractAddress: string) {
    return this.dataProvider.getEvents({ contractAddress, limit: 50 });
  }

  // Custom query — use raw GraphQL
  async getEventFrequency(contractAddress: string, days: number) {
    return this.graphqlClient.request(`
      query EventStats($address: String!, $days: Int!) {
        events(contractAddress: $address, sinceDays: $days) {
          totalCount, groupBy { eventType, count }
        }
      }
    `, { address: contractAddress, days });
  }
}
```

---

## 8. Putting It All Together: A Complete Example

Here's a complete confidential token transfer that generates a ZK proof via the proof server, submits it to the ledger, and monitors the result through the indexer:

```typescript
import { MidnightProvider, indexerPublicDataProvider, ProofServerClient } from "@midnight-ntwrk/sdk";
import { createClient, subscribe } from "graphql-ws";

const CONFIG = {
  proofServerUrl: "http://localhost:3001",
  indexerUrl: "http://localhost:4000/graphql",
  indexerWsUrl: "ws://localhost:4000/graphql",
  contractAddress: "0xTOKEN_CONTRACT_ADDRESS",
};

const proofClient = new ProofServerClient(CONFIG.proofServerUrl);
const provider = new MidnightProvider({
  indexerUrl: CONFIG.indexerUrl,
  indexerWsUrl: CONFIG.indexerWsUrl,
});
const dataProvider = indexerPublicDataProvider(provider);
const wsClient = createClient({ url: CONFIG.indexerWsUrl });

async function submitConfidentialTransfer(
  senderKey: string,
  recipient: string,
  amount: bigint,
  merkleRoot: string
) {
  console.log("=== Starting Confidential Transfer ===\n");

  // Step 1: Generate the ZK proof
  console.log("[1/4] Generating ZK proof...");
  const proof = await proofClient.generateProof({
    circuitName: "confidentialTransfer",
    inputs: { senderKey, recipient, amount: amount.toString(), merkleRoot },
  });
  console.log(`  Proof ID: ${proof.proofId}\n`);

  // Step 2: Submit the transaction
  console.log("[2/4] Submitting transaction...");
  const txResult = await dataProvider.submitTransaction({
    contractAddress: CONFIG.contractAddress,
    action: "transfer",
    proof: proof.proof,
    publicInputs: proof.publicInputs,
  });
  console.log(`  Transaction hash: ${txResult.hash}\n`);

  // Step 3: Wait for confirmation via WebSocket subscription
  console.log("[3/4] Waiting for confirmation...");
  const stream = subscribe(wsClient, {
    query: `subscription OnTxStatus($hash: String!) {
      transactionStatusChanged(hash: $hash) { status, blockHeight, failureReason }
    }`,
    variables: { hash: txResult.hash },
  });

  for await (const event of stream) {
    const { transactionStatusChanged } = event as {
      transactionStatusChanged: { status: string; blockHeight?: number; failureReason?: string };
    };

    if (transactionStatusChanged.status === "INCLUDED") {
      console.log(`  ✓ Confirmed at block #${transactionStatusChanged.blockHeight}\n`);
      break;
    } else if (transactionStatusChanged.status === "FAILED") {
      throw new Error(`Transaction failed: ${transactionStatusChanged.failureReason}`);
    }
  }

  // Step 4: Verify the event was emitted
  console.log("[4/4] Verifying transfer event...");
  const events = await dataProvider.getEvents({
    contractAddress: CONFIG.contractAddress,
    eventType: "ConfidentialTransfer",
    limit: 1,
    orderBy: "BLOCK_HEIGHT_DESC",
  });

  if (events.length > 0) {
    console.log(`  Event found: ${events[0].type} at block ${events[0].blockHeight}`);
  }

  console.log("\n=== Transfer Complete ===");
}

// Usage
submitConfidentialTransfer(
  "0xSENDER_PRIVATE_KEY",
  "0xRECIPIENT_ADDRESS",
  500n,
  "0xMERKLE_ROOT_FROM_STATE"
).catch(console.error);
```

This demonstrates the full flow: proof generation → transaction submission → real-time status monitoring → event verification. In production, add error handling, retries, and a transaction pool for managing multiple pending transactions.

---

## 9. Troubleshooting Common Issues

### Proof Server Issues

**Proof generation is timing out** — Increase the timeout in your SDK configuration. Check `docker logs midnight-proof-server`. Verify circuit inputs are correct — malformed inputs can cause the prover to loop indefinitely. Ensure `PROOF_SERVER_MAX_CONCURRENT_PROOFS` isn't set too low.

**Proof is rejected by the ledger** — Check version compatibility first. This is almost always a version mismatch between the proof server and ledger. Ensure your circuit was compiled with the same version of the Compact compiler as the proof server expects.

### Indexer Issues

**Stale data** — Check indexer logs for sync errors: `docker logs midnight-indexer`. Verify `INDEXER_LEDGER_URL` points to the correct node. If the indexer fell behind, it may need time to catch up.

**WebSocket subscriptions disconnect frequently** — Enable automatic reconnection with exponential backoff. Check if the indexer container is restarting (`docker ps -a`). Ensure no reverse proxy is killing idle WebSocket connections.

### Version Mismatch

Run this checklist:
1. `docker images | grep midnight` — verify all images have matching tags.
2. `docker inspect <container> | grep -i version` — confirm running versions match.
3. If you recently pulled new images: `docker compose down && docker image prune -f && docker compose up -d`.

### SDK vs Direct GraphQL

**The `indexerPublicDataProvider` doesn't have a method I need** — The SDK doesn't wrap every possible query. For anything beyond standard operations (transactions, events, contract state), fall back to direct GraphQL queries using `GraphQLClient`. This is by design — the SDK covers the common case, and GraphQL handles edge cases.

---

## Conclusion

The proof server and indexer are the backbone of any Midnight dApp. The proof server handles ZK proof generation that makes privacy possible, while the indexer provides efficient, real-time access to on-chain data.

Key takeaways:
- **Always match Docker tags to your ledger version** — version mismatches are the #1 source of mysterious failures.
- **Use WebSocket subscriptions** for anything that needs to react to on-chain activity in real time.
- **Start with `indexerPublicDataProvider`** for common queries, and drop to raw GraphQL when you need more control.
- **Monitor your proof server logs** during development — they'll tell you quickly when circuit inputs are wrong or constraints are failing.

With this foundation, you're ready to build privacy-preserving dApps on Midnight. Happy coding!

---

*This tutorial was written for Midnight Bounty #308.*
