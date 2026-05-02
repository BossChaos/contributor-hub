# Compact Standard Library: The Complete Developer's Guide

A practical walkthrough of every export in Midnight's Compact standard library, with working code examples.

## Repository Structure

```
compact-stdlib-guide/
├── contracts/
│   ├── maybe-example.compact
│   ├── either-example.compact
│   ├── merkle-registry.compact
│   ├── commitment-voting.compact
│   ├── elliptic-curves.compact
│   ├── access-control.compact
│   ├── token-vault.compact
│   ├── block-time-escrow.compact
│   └── amm-pool.compact
├── README.md
└── TUTORIAL.md
```

## Setup

```bash
# Install Midnight SDK
npm install @midnight-ntwrk/compact-compiler

# Compile a contract
npx compactc contracts/token-vault.compact
```

## All Standard Library Exports (~30)

### Category 1: Generic Types

| Export | Type | Purpose |
|--------|------|---------|
| `Maybe<T>` | Generic Type | Optional value (Some/None) |
| `Either<L, R>` | Generic Type | Two-outcome result (Left/Right) |

### Category 2: Merkle Trees & Commitments

| Export | Type | Purpose |
|--------|------|---------|
| `MerkleTree<N, T>` | Generic Type | Fixed-depth Merkle tree |
| `persistentCommit(witness)` | Helper Circuit | Create anchored commitment |
| `verifyCommitment(witness, public)` | Helper Circuit | Verify commitment matches |

### Category 3: Elliptic Curves

| Export | Type | Purpose |
|--------|------|---------|
| `CurvePoint` | Type | Elliptic curve point |
| `Scalar` | Type | Scalar field element |
| `Curve25519` | Module | Ed25519 curve operations |

### Category 4: Kernel Types

| Export | Type | Purpose |
|--------|------|---------|
| `ContractAddress` | Type | Contract identity |
| `ZswapCoinPublicKey` | Type | Shielded coin public key |
| `UserAddress` | Type | User-facing address |
| `ShieldedCoinInfo` | Type | Coin metadata |
| `QualifiedShieldedCoinInfo` | Type | Spendable coin with nullifier |
| `CoinProof` | Type | ZK proof for coin ownership |

### Category 5: Helper Circuits

| Export | Type | Purpose |
|--------|------|---------|
| `nativeToken()` | Function | MNT token type ID |
| `tokenType(addr)` | Function | Custom token type ID |
| `evolveNonce(nonce)` | Function | Advance nonce for replay protection |
| `shieldedBurnAddress()` | Function | Address for token burns |

### Category 6: Shielded Token Operations

| Export | Type | Purpose |
|--------|------|---------|
| `receiveShielded(proof)` | Circuit | Accept incoming shielded coin |
| `sendShielded(recipient, coin, amount)` | Circuit | Send shielded coins |
| `splitCoin(coin, amounts)` | Circuit | Split coin into multiple outputs |
| `mergeCoins(coin1, coin2)` | Circuit | Merge two coins into one |
| `sendShieldedExact(recipient, coin, amount, changeKey)` | Circuit | Send with explicit change |
| `burnShielded(coin, amount)` | Circuit | Burn shielded tokens |

### Category 7: Block-Time Queries

| Export | Type | Purpose |
|--------|------|---------|
| `getBlockTime()` | Function | Current block timestamp |
| `getBlockNumber()` | Function | Current block height |
| `getEpoch()` | Function | Current epoch number |

## Quick Reference

See individual contract files for complete working examples of each export.
