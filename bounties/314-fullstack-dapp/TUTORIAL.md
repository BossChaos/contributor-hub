---
title: "Full-Stack Midnight dApp: Contract + TypeScript API + React Frontend + Wallet"
---

# Full-Stack Midnight dApp: Contract + TypeScript API + React Frontend + Wallet

Building a complete dApp on Midnight requires coordinating multiple layers: a privacy-preserving smart contract, TypeScript witness implementations, a wallet connection layer, and a React frontend that lets users interact with it all.

This tutorial walks through the entire development lifecycle — from writing your first Compact contract to deploying a working dApp on mainnet and interacting with it in the browser.

## Architecture Overview

```
+--------------------------------------------------+
|               Full-Stack Architecture              |
|                                                    |
|  +-------------+    +------------------+          |
|  |  React UI   |--->| TypeScript API   |          |
|  | Components  |    | (Witnesses)      |          |
|  +-------------+    +--------+---------+          |
|                            |                      |
|               +------------+------------+         |
|               |    dApp Connector        |         |
|               |    (Lace / 1AM)          |         |
|               +------------+------------+         |
|                            |                      |
|               +------------+------------+         |
|               |   Midnight Network      |         |
|               |   + Proof Server        |         |
|               +------------+------------+         |
|                            |                      |
|               +------------+------------+         |
|               |  Cardano Blockchain     |         |
|               |  (Consensus Layer)      |         |
|               +-------------------------+         |
+--------------------------------------------------+
```

## Step 1: Set Up Your Development Environment

```bash
# Install Midnight toolchain
curl -sSf https://install.midnight.network | sh

# Verify installation
midnight-cli --version

# Create a new project
midnight-cli init fullstack-dapp
cd fullstack-dapp

# Install Node.js dependencies
npm install
```

This creates a scaffold with:
- `src/contract/` — Compact smart contracts
- `src/witness/` — TypeScript witness implementations
- `src/client/` — React frontend
- `config/` — Network and deployment configuration

## Step 2: Write the Compact Contract

We will build a **Private Voting Contract** — a dApp where users can vote on proposals without revealing their individual choices. The contract uses Midnight's privacy features to:

1. Allow eligible voters to cast secret votes
2. Tally results publicly without revealing individual votes
3. Prevent double-voting using nullifiers

```compact
// src/contract/PrivateVoting.compact

import "StandardLib";

contract PrivateVoting {

    // Proposal data
    val proposalId: String;
    val description: String;
    val startTime: U64;
    val endTime: U64;

    // Vote tallies (public)
    var yesVotes: U64;
    var noVotes: U64;

    // Voter registry (private commitments)
    var voterCommitments: Set<Hash>;

    // Nullifier set (prevents double-voting)
    var usedNullifiers: Set<Hash>;

    // Contract owner
    val owner: Address;

    constructor(
        proposalId: String,
        description: String,
        startTime: U64,
        endTime: U64,
        initialVoters: Set<Hash>,
        owner: Address
    ) {
        this.proposalId = proposalId;
        this.description = description;
        this.startTime = startTime;
        this.endTime = endTime;
        this.yesVotes = 0u64;
        this.noVotes = 0u64;
        this.voterCommitments = initialVoters;
        this.usedNullifiers = Set.new();
        this.owner = owner;
    }

    // Cast a vote (yes=true, no=false)
    action castVote(vote: Bool, voterCommitment: Hash, nullifier: Hash) {
        require(currentBlockTime() >= this.startTime, "Voting not started");
        require(currentBlockTime() <= this.endTime, "Voting has ended");
        require(this.voterCommitments.contains(voterCommitment), "Not an eligible voter");
        require(!this.usedNullifiers.contains(nullifier), "Already voted");

        // Record the nullifier to prevent double-voting
        this.usedNullifiers.insert(nullifier);

        // Update the tally
        if (vote) {
            this.yesVotes = this.yesVotes + 1u64;
        } else {
            this.noVotes = this.noVotes + 1u64;
        }
    }

    // Get current results
    view results(): (U64, U64) {
        return (this.yesVotes, this.noVotes);
    }

    // Get voting status
    view status(): String {
        let now = currentBlockTime();
        if (now < this.startTime) {
            return "Not started";
        } else if (now > this.endTime) {
            return "Ended";
        } else {
            return "Active";
        }
    }
}
```

### Compile the Contract

```bash
midnight-cli compile src/contract/PrivateVoting.compact
```

## Step 3: TypeScript Witness Implementation

The witness layer bridges your Compact contract with the client application:

```typescript
// src/witness/PrivateVoting.ts
import { WalletProvider } from '@midnight-ntwrk/wallet-provider';
import { IndexerClient } from '@midnight-ntwrk/indexer-client';
import { PrivateVoting } from '../generated/PrivateVoting';

export class PrivateVotingClient {
    private wallet: WalletProvider;
    private contract: PrivateVoting;
    private indexer: IndexerClient;

    constructor(
        wallet: WalletProvider,
        contractAddress: string,
        indexerUrl: string = 'http://localhost:9945'
    ) {
        this.wallet = wallet;
        this.contract = PrivateVoting.at(contractAddress, wallet);
        this.indexer = new IndexerClient(indexerUrl);
    }

    // Cast a vote
    async castVote(
        vote: boolean,
        voterCommitment: string,
        nullifier: string
    ): Promise<string> {
        const tx = await this.contract.castVote(vote, voterCommitment, nullifier);
        const result = await tx.submit();
        return result.txHash;
    }

    // Get current results
    async getResults(): Promise<{ yes: bigint; no: bigint }> {
        const [yes, no] = await this.contract.results();
        return { yes, no };
    }

    // Get voting status
    async getStatus(): Promise<string> {
        return await this.contract.status();
    }
}
```

## Step 4: Wallet Provider Setup

Midnight supports two wallet providers via the dApp Connector API:

### Lace Wallet (IOG Official)

```typescript
import { WalletProvider } from '@midnight-ntwrk/wallet-provider';

export async function connectLace(): Promise<WalletProvider> {
    const lace = (window as any).lace;
    if (!lace) {
        throw new Error('Lace wallet not installed. Visit lace.io to install.');
    }
    await lace.enable();
    return WalletProvider.fromExtension('lace');
}
```

### 1AM Wallet (Community)

```typescript
import { WalletProvider } from '@midnight-ntwrk/wallet-provider';

export async function connectOneAM(): Promise<WalletProvider> {
    const oneam = (window as any)['1am'];
    if (!oneam) {
        throw new Error('1AM wallet not installed.');
    }
    await oneam.enable();
    return WalletProvider.fromExtension('1am');
}
```

## Step 5: Build the React Frontend

### Main Dashboard Component

```tsx
import { useState, useEffect } from 'react';
import { PrivateVotingClient } from '../../witness/PrivateVoting';
import { WalletProvider } from '@midnight-ntwrk/wallet-provider';

export const VotingDashboard = ({ wallet, contractAddress }) => {
    const [client, setClient] = useState(null);
    const [results, setResults] = useState({ yes: 0n, no: 0n });
    const [status, setStatus] = useState('Loading...');
    const [submitting, setSubmitting] = useState(false);
    const [txHash, setTxHash] = useState(null);

    useEffect(() => {
        const c = new PrivateVotingClient(wallet, contractAddress);
        setClient(c);
        loadData(c);
    }, [wallet, contractAddress]);

    const loadData = async (c) => {
        try {
            const [results, status] = await Promise.all([
                c.getResults(),
                c.getStatus(),
            ]);
            setResults(results);
            setStatus(status);
        } catch (err) {
            console.error('Failed to load voting data:', err);
        }
    };

    const castVote = async (choice) => {
        if (!client || submitting) return;
        setSubmitting(true);
        try {
            const hash = await client.castVote(choice, 'commitment', 'nullifier');
            setTxHash(hash);
            await loadData(client);
        } catch (err) {
            console.error('Vote submission failed:', err);
        } finally {
            setSubmitting(false);
        }
    };

    const total = Number(results.yes) + Number(results.no);
    const yesPercent = total > 0 ? (Number(results.yes) / total * 100).toFixed(1) : '0.0';

    return (
        <div className="voting-dashboard">
            <div className={`status-banner ${status.toLowerCase()}`}>
                {status === 'Active' ? 'Voting is Active' : `Voting is ${status}`}
            </div>

            <div className="results-card">
                <h2>Current Results</h2>
                <div className="results-bar">
                    <div className="bar-yes" style={{ width: `${yesPercent}%` }}>
                        Yes: {yesPercent}% ({results.yes})
                    </div>
                </div>
                <p>Total votes: {total}</p>
            </div>

            {status === 'Active' && (
                <div className="vote-section">
                    <h2>Cast Your Vote</h2>
                    <p>Your vote is private. Only the tally is public.</p>
                    <div className="vote-buttons">
                        <button onClick={() => castVote(true)} disabled={submitting}>
                            {submitting ? 'Submitting...' : 'Yes'}
                        </button>
                        <button onClick={() => castVote(false)} disabled={submitting}>
                            {submitting ? 'Submitting...' : 'No'}
                        </button>
                    </div>
                </div>
            )}

            {txHash && (
                <div className="tx-confirmation">
                    <h3>Vote Submitted!</h3>
                    <p>Transaction: <code>{txHash}</code></p>
                    <a href={`https://explorer.midnight.network/tx/${txHash}`} target="_blank">
                        View on Explorer
                    </a>
                </div>
            )}
        </div>
    );
};
```

## Step 6: Deploy to Mainnet

### Deploy the Contract

```bash
midnight-cli deploy src/contract/PrivateVoting.compact \
    --network mainnet \
    --args '"PROP-001" "Feature X?" 1700000000 1700086400 "[]" "your-address"'
```

### Build and Deploy the Frontend

```bash
# Build the React app
npm run build

# Deploy to a static host
npx vercel --prod
```

## Step 7: Testing the Full Lifecycle

1. **Compile** — Verify contract compiles
2. **Deploy** — Deploy to mainnet
3. **Connect** — Open the frontend, connect your wallet
4. **Interact** — Cast a vote, verify transaction
5. **Query** — Check results update in real-time
6. **Verify** — Look up your transaction on the explorer

## Conclusion

This tutorial covered the complete Midnight full-stack development lifecycle:

- **Compact contract** — Private voting with privacy-preserving mechanics
- **TypeScript witnesses** — Contract interaction layer with wallet integration
- **dApp Connector** — Wallet setup for Lace and 1AM
- **React frontend** — Voting dashboard with live results
- **Mainnet deployment** — Full deployment workflow

Midnight's architecture separates contract logic (Compact), proof generation (Proof Server), state tracking (Indexer), and user interaction (React + Wallet). Understanding these layers and how they connect is the key to building production-ready dApps on the network.

The pattern you have learned here — contract to witnesses to wallet to frontend — applies to every Midnight dApp, whether you are building DeFi protocols, NFT marketplaces, or enterprise privacy solutions.
