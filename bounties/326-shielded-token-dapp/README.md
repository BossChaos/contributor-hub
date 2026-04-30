# Building a Shielded Token dApp with UI: Complete End-to-End Guide

Privacy isn't just a feature — it's a fundamental property that needs to be baked into your architecture from day one. When building on Midnight, you're working with a blockchain that treats privacy as a first-class citizen, which means your dApp needs to respect that design philosophy at every level.

This tutorial walks you through building a complete shielded token dApp from scratch. You'll learn how to write the Compact contract, generate TypeScript witnesses, integrate with Lace/1AM wallets, and build a React frontend that lets users interact with shielded tokens in their browser.

By the end, you'll have a working dApp that supports the full token lifecycle: minting, transferring, and burning — all while keeping balances and transaction details private.

## Why Shielded Tokens Matter

Traditional blockchains expose every transaction to the public. Anyone can see who sent what to whom, when, and how much. This is fine for transparent ledgers, but problematic for real-world applications where privacy is expected.

Midnight solves this with zero-knowledge proofs. Your contract can verify that a transaction is valid without revealing the underlying data. The sender's balance, the recipient's identity, and the transaction amount all stay private — only the fact that a valid transfer occurred is recorded on-chain.

This is what "shielded" means: the data exists, it's being used in computations, but it's cryptographically hidden from everyone except the parties involved.

## Architecture Overview

Before writing code, let's understand the pieces:

**Compact Contract** — The on-chain logic. Defines circuits for minting, transferring, and burning tokens. Manages the Merkle root of commitments and the nullifier set to prevent double-spending.

**TypeScript Witnesses** — The off-chain computation. Generates the private inputs (amounts, secrets, Merkle paths) that circuits need to create proofs. These never touch the blockchain.

**Wallet Integration** — The bridge between user and contract. Lace and 1AM wallets manage keys, generate proofs via the proof server, and submit transactions to the network.

**React Frontend** — The user interface. Lets users connect their wallet, view balances, and trigger operations. Communicates with the contract through the wallet's dApp connector API.

Here's how they fit together:

```
User → React UI → Wallet (Lace/1AM) → Proof Server → Midnight Network
                ↑                              ↓
                └── Compact Contract ←─────── On-chain State
```

The user clicks a button in the UI. The frontend generates witnesses and sends them to the wallet. The wallet's proof server creates a ZK proof. The proof + public inputs are submitted to the network. The contract verifies and updates state.

## Step 1: The Compact Contract

Let's start with the contract. This defines what operations are possible and what state lives on-chain.

### Core State

Every shielded token contract needs three pieces of public state:

```compact
pragma language_version >= 0.22;

contract ShieldedToken {
    // Merkle root of all active commitments
    ledger commitmentRoot: Bytes<32>;
    
    // Set of used nullifiers (prevents double-spending)
    ledger nullifierSet: Set<Bytes<32>>;
    
    // Aggregate supply (not individual balances)
    ledger totalSupply: Uint<64>;
}
```

The `commitmentRoot` is the anchor of the entire system. It's a single hash that represents the entire set of token commitments. When someone mints or transfers tokens, the root updates. The `nullifierSet` tracks which commitments have been spent — if a nullifier appears twice, the transaction is rejected. The `totalSupply` is optional but useful for auditing; it shows the aggregate, not individual, balances.

### Minting

Minting creates a new commitment. The user specifies an amount and a secret. The contract verifies the commitment is valid and updates the root.

```compact
circuit mintShieldedToken(
    witness amount: Uint<64>,
    witness secret: Bytes<32>,
    public commitment: Bytes<32>,
    public newRoot: Bytes<32>
) {
    // Verify commitment = H(amount, secret)
    assert commitment == hash(amount, secret) : "invalid commitment";
    
    // Verify new root is not empty
    assert newRoot != Bytes<32>::from([0u8; 32]) : "invalid root";
    
    // Update state
    commitmentRoot = newRoot;
    totalSupply += amount;
}
```

Notice the pattern: `witness` parameters are private (known only to the prover), `public` parameters are visible on-chain. The contract only verifies the relationship between them — it never sees the actual amount or secret.

### Transferring

Transferring is where things get interesting. You need to prove you own a commitment, spend it, and create new commitments for the recipient and change — all without revealing balances.

```compact
circuit sendShielded(
    witness senderBalance: Uint<64>,
    witness senderSecret: Bytes<32>,
    witness recipientAmount: Uint<64>,
    witness recipientSecret: Bytes<32>,
    witness changeAmount: Uint<64>,
    witness changeSecret: Bytes<32>,
    public senderNullifier: Bytes<32>,
    public recipientCommitment: Bytes<32>,
    public changeCommitment: Bytes<32>,
    public newRoot: Bytes<32>,
    public transferAmount: Uint<64>
) {
    // Verify sender has enough
    assert senderBalance >= transferAmount : "insufficient balance";
    
    // Verify nullifier = H(senderSecret, 0)
    assert senderNullifier == hash(senderSecret, 0u8) : "invalid nullifier";
    
    // Prevent double-spending
    assert !nullifierSet.contains(senderNullifier) : "nullifier already used";
    
    // Verify commitments are valid
    assert recipientCommitment == hash(recipientAmount, recipientSecret) : "invalid recipient commitment";
    assert changeCommitment == hash(changeAmount, changeSecret) : "invalid change commitment";
    
    // Conservation: balance = transfer + change
    assert senderBalance == transferAmount + changeAmount : "conservation violated";
    
    // Record spent commitment
    nullifierSet.insert(senderNullifier);
    commitmentRoot = newRoot;
}
```

The key insight here is **conservation**. The circuit proves that `senderBalance = transferAmount + changeAmount` without revealing any of those values. The on-chain state only sees the nullifier (which prevents reuse) and the new root (which reflects the updated commitment set).

### Burning

Burning destroys tokens. The user provides a commitment, the contract verifies ownership, and reduces the total supply.

```compact
circuit shieldedBurnAddress(
    witness burnAmount: Uint<64>,
    witness burnSecret: Bytes<32>,
    public burnNullifier: Bytes<32>,
    public newRoot: Bytes<32>
) {
    assert burnNullifier == hash(burnSecret, 0u8) : "invalid burn nullifier";
    assert !nullifierSet.contains(burnNullifier) : "nullifier already used";
    
    nullifierSet.insert(burnNullifier);
    totalSupply -= burnAmount;
    commitmentRoot = newRoot;
}
```

## Step 2: TypeScript Witnesses

The contract defines what's possible. The witnesses define how to actually do it.

Witnesses are the private inputs to circuits. They're generated off-chain by the user's client and never sent to the blockchain. The proof server uses them to create a ZK proof, which is what gets submitted.

### Commitment and Nullifier Functions

```typescript
import { randomBytes, createHash } from 'crypto';

// Compute commitment: H(amount, secret)
export function computeCommitment(amount: bigint, secret: Uint8Array): Uint8Array {
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64BE(amount);
  
  const hash = createHash('sha256');
  hash.update(amountBuf);
  hash.update(Buffer.from(secret));
  return hash.digest();
}

// Compute nullifier: H(secret, 0)
export function computeNullifier(secret: Uint8Array): Uint8Array {
  const hash = createHash('sha256');
  hash.update(Buffer.from(secret));
  hash.update(Buffer.from([0]));
  return hash.digest();
}
```

### Witness Generation

For each circuit operation, you need a witness object:

```typescript
// For minting
interface MintWitness {
  amount: bigint;
  secret: Uint8Array;
}

// For sending
interface SendWitness {
  senderBalance: bigint;
  senderSecret: Uint8Array;
  recipientAmount: bigint;
  recipientSecret: Uint8Array;
  changeAmount: bigint;
  changeSecret: Uint8Array;
}

// For burning
interface BurnWitness {
  burnAmount: bigint;
  burnSecret: Uint8Array;
}
```

The key rule: **never reuse secrets**. Each commitment needs a unique secret. If you reuse a secret, someone can link the commitments together and break privacy.

## Step 3: Wallet Integration

Midnight supports two main wallets: Lace and 1AM. Both expose a `window.midnight` object (the dApp connector API) that your frontend uses to interact with the network.

### Detecting the Wallet

```typescript
async function connectWallet() {
  if (typeof window !== 'undefined' && (window as any).midnight) {
    const midnight = (window as any).midnight;
    const provider = midnight.lace ? 'lace' : 'one-am';
    const result = await midnight.enable();
    return { address: result.address, provider, connected: true };
  }
  throw new Error('Midnight wallet not found');
}
```

### Calling Contract Circuits

Once connected, you call circuits through the wallet:

```typescript
const result = await midnight.call({
  contractAddress: '0x...',
  circuit: 'sendShielded',
  publicInputs: {
    senderNullifier: bytesToHex(senderNullifier),
    recipientCommitment: bytesToHex(recipientCommitment),
    changeCommitment: bytesToHex(changeCommitment),
    newRoot: bytesToHex(newRoot),
    transferAmount: transferAmount.toString(),
  },
  witness: {
    senderBalance: senderBalance.toString(),
    senderSecret: bytesToHex(senderSecret),
    // ... other private inputs
  },
});
```

The wallet does three things:
1. Sends witnesses to the proof server to generate a ZK proof
2. Packages the proof with public inputs
3. Submits the transaction to the network

You don't need to worry about proof generation details — the wallet handles it.

## Step 4: Building the React Frontend

The frontend ties everything together. Here's the structure:

```
src/
├── components/
│   ├── WalletConnect.tsx    // Connection UI
│   ├── TokenBalance.tsx     // Display balance
│   ├── MintPanel.tsx        // Minting form
│   ├── SendPanel.tsx        // Transfer form
│   └── BurnPanel.tsx        // Burning form
├── hooks/
│   └── useMidnightWallet.ts // Wallet state management
├── utils/
│   └── witnesses.ts         // Witness generation
└── App.tsx                  // Main component
```

### Key Components

**WalletConnect** — Detects wallet, handles connection/disconnection, displays address and provider.

**TokenBalance** — Reads the contract's public state (totalSupply) and the user's private balance (from local storage/wallet).

**MintPanel/SendPanel/BurnPanel** — Forms that collect user input, generate witnesses, and call the wallet.

### State Management

Use React hooks to manage wallet state:

```typescript
const [wallet, setWallet] = useState<WalletInfo | null>(null);
const [balance, setBalance] = useState<TokenBalance>({ shielded: 0n, unshielded: 0n });
const [txResult, setTxResult] = useState<TransactionResult | null>(null);
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);
```

The `loading` state is important — proof generation takes time (usually 2-5 seconds). Show a spinner or progress indicator so users know something is happening.

### Error Handling

Things can go wrong at multiple levels:
- **Wallet not connected** — User needs to connect first
- **Insufficient balance** — User doesn't have enough tokens
- **Proof generation failed** — Network issue or invalid witnesses
- **Transaction rejected** — Contract rejected the proof (double-spend, invalid state)

Handle each case explicitly:

```typescript
try {
  const result = await sendShieldedToken(...);
  setTxResult(result);
} catch (err) {
  if (err.message.includes('insufficient balance')) {
    setError('You don\'t have enough shielded tokens');
  } else if (err.message.includes('nullifier already used')) {
    setError('This transaction was already submitted');
  } else {
    setError(err.message);
  }
}
```

## Step 5: Testing

Test both the contract and the frontend.

### Contract Tests

```typescript
import { ShieldedToken } from '../contract/ShieldedToken';

describe('ShieldedToken', () => {
  it('should mint tokens correctly', async () => {
    const contract = new ShieldedToken();
    const witness = createMintWitness(100n);
    const commitment = computeCommitment(witness.amount, witness.secret);
    
    const result = await contract.mintShieldedToken({
      witness,
      publicInputs: { commitment, newRoot: computeNewRoot(commitment) },
    });
    
    expect(result.success).toBe(true);
    expect(contract.totalSupply).toBe(100n);
  });
  
  it('should reject double-spend', async () => {
    // ... test that reusing a nullifier fails
  });
  
  it('should conserve tokens during transfer', async () => {
    // ... test that senderBalance = transferAmount + changeAmount
  });
});
```

### Frontend Tests

Test the UI interactions:
- Wallet connection flow
- Form validation
- Error display
- Transaction status updates

## Common Pitfalls

**Reusing secrets** — This is the most common mistake. Each commitment needs a unique secret. If you reuse a secret, the nullifier will be the same, and the second transaction will be rejected. Worse, if you somehow bypass the nullifier check, you've broken privacy.

**Incorrect conservation** — The circuit proves `senderBalance = transferAmount + changeAmount`. If your witness generation doesn't satisfy this, the proof will be invalid. Always verify: `changeAmount = senderBalance - transferAmount`.

**Not handling proof generation time** — ZK proof generation takes time. Don't assume transactions are instant. Show progress indicators and handle timeouts gracefully.

**Hardcoding contract addresses** — Deploy to testnet first, get the address, then use it. Don't hardcode mainnet addresses in your code.

**Ignoring wallet detection** — Not all users have Lace or 1AM installed. Detect the wallet and show appropriate error messages if it's missing.

## Deployment

### Deploying the Contract

1. Compile the Compact contract: `midnight compile ShieldedToken.compact`
2. Deploy to testnet: `midnight deploy --network testnet`
3. Note the contract address from the deployment output

### Deploying the Frontend

1. Build: `npm run build`
2. Deploy to your hosting provider (Vercel, Netlify, etc.)
3. Update the contract address in your frontend code

## Summary

Building a shielded token dApp requires understanding four layers: the contract (what's possible), the witnesses (how to do it), the wallet (how to submit), and the frontend (how users interact).

The key principles:
- **Privacy is default** — All token operations use ZK proofs
- **Conservation is enforced** — The circuit proves balances are conserved
- **Nullifiers prevent reuse** — Each commitment can only be spent once
- **Witnesses are private** — They never touch the blockchain

If you're building something more complex (DeFi protocols, NFTs with privacy, etc.), these same principles apply. The contract defines the rules, the witnesses provide the private data, and the wallet handles the proof generation.

---

**Full source code:** Available in the repository linked in this PR.

**Wallet Address:** RTC6d1f27d28961279f1034d9561c2403697eb55602
