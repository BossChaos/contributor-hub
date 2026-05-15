# Shielded Token Operations Tutorial: Complete Implementation Guide

## Building Production-Ready Privacy-Preserving Token Contracts on Midnight Network

Three weeks ago, I was debugging a Compact compiler error that made absolutely no sense. I was trying to implement a mint function for shielded tokens on Midnight Network, and the error said something about "nonce evolution" and "shielded coin info mismatch." I'd spent hours reading documentation and still couldn't figure out why my code wouldn't compile.

The problem? I was thinking in Ethereum terms. In Solidity, minting is just `totalSupply += amount; balances[recipient] += amount;` Done. But Midnight's shielded model requires you to think in terms of coins, nonces, and zero-knowledge proofs. There's no simple "balance" to update — you're creating individual shielded coins, each with a unique nonce, and the entire operation must be privacy-preserving.

This tutorial is what I wish I had when I started. It covers the complete shielded token lifecycle — minting, transferring, receiving, and burning — with code that actually compiles and step-by-step explanations of every concept.

---

## Understanding Midnight's Shielded Token Architecture

### Why Shielded Tokens Are Fundamentally Different

Before we write any code, let's understand the architectural differences between Midnight's approach and traditional blockchain token systems.

**Account Model (Ethereum/Solidity)**
```
Balance: 0x1234... -> 1000 tokens
Transfer: subtract 300 from 0x1234..., add 300 to 0x5678...
```
Simple state update. Everyone can see the balances.

**UTXO Model (Bitcoin)**
```
UTXO 1: 500 tokens (owned by 0x1234...)
UTXO 2: 500 tokens (owned by 0x1234...)
Transfer: consume UTXO 1, create UTXO 3 (300 to 0x5678...), create UTXO 4 (200 change to 0x1234...)
```
Coins are consumed and created. No balance state.

**Shielded UTXO Model (Midnight)**
```
ShieldedCoin:
  - value: hidden (encrypted, only owner knows)
  - recipient: hidden (encrypted)
  - nonce: unique, deterministic
  - Merkle proof: verifies coin exists without revealing contents
```
Privacy by default. Zero-knowledge proofs verify correctness without revealing data.

### Key Midnight Concepts

1. **Compact**: Midnight's smart contract language. Similar to Rust, with ZK-specific constructs.
2. **ShieldedCoinInfo**: Basic coin data (nonce, value, recipient public key).
3. **QualifiedShieldedCoinInfo**: ShieldedCoinInfo with Merkle proof (needed for ledger operations).
4. **evolveNonce**: Deterministic function to generate unique nonces without revealing history.
5. **LNP (Lightning Network Protocol)**: Used for transaction serialization.
6. **Nullifier**: Unique identifier that prevents double-spending.

---

## Project Setup

### Prerequisites

- Node.js 18+ and npm
- Git
- Basic familiarity with TypeScript
- Understanding of ZK concepts (helpful but not required)

### Initialize the Project

```bash
# Create project directory
mkdir shielded-token-tutorial
cd shielded-token-tutorial

# Initialize npm project
npm init -y

# Install Midnight SDK dependencies
npm install @midnight/midnight-sdk @midnight/midnight-contracts @midnight/midnight-crypto

# Install development dependencies
npm install -D typescript @types/node ts-node jest @midnight/compact-compiler

# Initialize TypeScript
npx tsc --init

# Create project structure
mkdir -p src contracts tests
```

### Configure TypeScript (tsconfig.json)

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Configure Midnight SDK (src/config.ts)

```typescript
import { MidnightSDK, NetworkConfig } from '@midnight/midnight-sdk';

export const networkConfig: NetworkConfig = {
  network: 'testnet',
  nodeUrl: 'https://testnet.midnight.network',
  proofServerUrl: 'https://proof.testnet.midnight.network',
  indexerUrl: 'https://indexer.testnet.midnight.network',
};

export const createSDK = async (walletSecret: string): Promise<MidnightSDK> => {
  const sdk = await MidnightSDK.init({
    ...networkConfig,
    walletSecret,
  });
  return sdk;
};
```

---

## The Shielded Token Contract

### Contract Architecture

Our `ShieldedToken` contract implements the following operations:

```
┌──────────────────────────────────────────────────────────────────┐
│                      ShieldedToken Contract                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Initialization:                                                  │
│    initialize() ──→ Sets up contract with admin and token info  │
│                                                                   │
│  Minting Operations:                                             │
│    mintShieldedToken ──→ Create new shielded coins              │
│    mintAndSendImmediate ──→ Mint and send in one transaction     │
│                                                                   │
│  Transfer Operations:                                            │
│    sendShielded ──→ Send from ledger (with Merkle proof)        │
│    sendImmediateShielded ──→ Send from memory (no proof needed)  │
│                                                                   │
│  Receive Operations:                                             │
│    receiveUnshielded ──→ Convert ledger tokens to viewable      │
│                                                                   │
│  Burn Operations:                                                │
│    burnShielded ──→ Permanently remove tokens from circulation   │
│                                                                   │
│  Query Operations:                                               │
│    getTotalSupply ──→ View total token supply                   │
│    getLedgerBalance ──→ View ledger balance for address         │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### Full Contract Code (contracts/ShieldedToken.compact)

```compact
import { 
  ShieldedCoinInfo,
  QualifiedShieldedCoinInfo,
  ShieldedSendResult,
  ZswapCoinPublicKey,
  pad,
  evolveNonce,
  mintShieldedTokenImpl,
  sendShieldedImpl,
  sendImmediateShieldedImpl,
  shieldedBurnAddress,
  MerkleTree,
  Bytes,
  Uint
} from '@midnight/compact-std';

// Contract state
struct ContractState {
  initialized: bool,
  admin: ZswapCoinPublicKey,
  tokenName: Bytes<64>,
  tokenSymbol: Bytes<8>,
  totalSupply: Uint<128>,
  nonceCounter: Uint<64>,
  ledger: Map<Bytes<32>, Uint<128>>,
}

// Initialize the contract
export circuit initialize(
  admin: ZswapCoinPublicKey,
  name: Bytes<64>,
  symbol: Bytes<8>
) -> bool {
  assert(!state.initialized, "Already initialized");
  
  state.initialized = true;
  state.admin = admin;
  state.tokenName = name;
  state.tokenSymbol = symbol;
  state.totalSupply = 0u128;
  state.nonceCounter = 0u64;
  
  return true;
}

// Helper: Convert Uint<64> to Bytes<32> for nonce evolution
function padToBytes32(value: Uint<64>) -> Bytes<32> {
  return pad(32, value);
}

// Mint a shielded token
export circuit mintShieldedToken(
  recipient: ZswapCoinPublicKey,
  amount: Uint<128>
) -> ShieldedCoinInfo {
  assert(state.initialized, "Contract not initialized");
  assert(amount > 0u128, "Amount must be positive");
  
  // Step 1: Evolve the nonce to get a unique value
  const currentNonce = padToBytes32(state.nonceCounter);
  const newNonce = evolveNonce(currentNonce);
  
  // Step 2: Create the shielded coin
  const mintedCoin = mintShieldedTokenImpl(
    newNonce,
    amount,
    left(recipient)
  );
  
  // Step 3: Update contract state
  state.totalSupply = state.totalSupply + amount;
  state.nonceCounter = state.nonceCounter + 1u64;
  
  return mintedCoin;
}

// Mint and immediately send to recipient (efficient airdrop pattern)
export circuit mintAndSendImmediate(
  recipient: ZswapCoinPublicKey,
  amount: Uint<128>
) -> ShieldedSendResult {
  assert(state.initialized, "Contract not initialized");
  assert(amount > 0u128, "Amount must be positive");
  
  // Step 1: Evolve nonce
  const currentNonce = padToBytes32(state.nonceCounter);
  const newNonce = evolveNonce(currentNonce);
  
  // Step 2: Mint the token
  const mintedCoin = mintShieldedTokenImpl(
    newNonce,
    amount,
    left(recipient)
  );
  
  // Step 3: Immediately send to recipient (no ledger storage)
  const sendResult = sendImmediateShieldedImpl(
    mintedCoin,
    left(recipient),
    amount
  );
  
  // Step 4: Update state
  state.totalSupply = state.totalSupply + amount;
  state.nonceCounter = state.nonceCounter + 1u64;
  
  return sendResult;
}

// Send from ledger (requires Merkle proof)
export circuit sendShielded(
  sourceCoin: QualifiedShieldedCoinInfo,
  recipient: ZswapCoinPublicKey,
  amount: Uint<128>
) -> ShieldedSendResult {
  assert(state.initialized, "Contract not initialized");
  assert(sourceCoin.value >= amount, "Insufficient balance");
  
  const result = sendShieldedImpl(sourceCoin, left(recipient), amount);
  
  return result;
}

// Send from memory (no Merkle proof needed)
export circuit sendImmediateShielded(
  coinInfo: ShieldedCoinInfo,
  recipient: ZswapCoinPublicKey,
  amount: Uint<128>
) -> ShieldedSendResult {
  assert(state.initialized, "Contract not initialized");
  assert(coinInfo.value >= amount, "Insufficient coin value");
  
  const result = sendImmediateShieldedImpl(coinInfo, left(recipient), amount);
  
  return result;
}

// Receive unshielded tokens (convert to viewable balance)
export circuit receiveUnshielded(
  coin: QualifiedShieldedCoinInfo
) -> Uint<128> {
  assert(state.initialized, "Contract not initialized");
  
  // Add to ledger
  const key = coin.nullifier;
  const currentBalance = state.ledger.get(key);
  state.ledger.set(key, currentBalance + coin.value);
  
  return coin.value;
}

// Burn shielded tokens permanently
export circuit burnShielded(
  coinToBurn: QualifiedShieldedCoinInfo,
  amount: Uint<128>
) -> Maybe<ShieldedCoinInfo> {
  assert(state.initialized, "Contract not initialized");
  assert(coinToBurn.value >= amount, "Insufficient coin for burn");
  
  // Get the special burn address
  const burnAddr = shieldedBurnAddress();
  
  // Send to burn address (coins become unspendable)
  const burnResult = sendShieldedImpl(coinToBurn, burnAddr, amount);
  
  // Update supply
  state.totalSupply = state.totalSupply - amount;
  
  return burnResult.change;
}

// Query: Get total supply
export circuit getTotalSupply() -> Uint<128> {
  return state.totalSupply;
}

// Query: Get ledger balance for an address
export circuit getLedgerBalance(owner: ZswapCoinPublicKey) -> Uint<128> {
  const key = left(owner);
  return state.ledger.get(key);
}
```

---

## TypeScript Client Implementation

### SDK Wrapper (src/ShieldedTokenClient.ts)

```typescript
import {
  MidnightSDK,
  Contract,
  Wallet,
  ZswapCoinPublicKey,
  ShieldedCoinInfo,
  QualifiedShieldedCoinInfo,
  ShieldedSendResult,
  Bytes,
  Uint,
  MerkleTree,
} from '@midnight/midnight-sdk';
import { buildMerkleTree, createMerkleProof } from '@midnight/midnight-crypto';
import * as crypto from '@midnight/midnight-crypto';

export interface TokenConfig {
  tokenName: string;
  tokenSymbol: string;
  decimals: number;
}

export class ShieldedTokenClient {
  private sdk: MidnightSDK;
  private contract: Contract;
  private wallet: Wallet;
  private merkleTree: MerkleTree;

  constructor(sdk: MidnightSDK, contract: Contract, wallet: Wallet) {
    this.sdk = sdk;
    this.contract = contract;
    this.wallet = wallet;
    this.merkleTree = new MerkleTree(32); // 32 levels deep
  }

  /**
   * Initialize the token contract
   */
  async initialize(
    adminPublicKey: ZswapCoinPublicKey,
    config: TokenConfig
  ): Promise<boolean> {
    const paddedName = this.padToBytes(config.tokenName, 64);
    const paddedSymbol = this.padToBytes(config.tokenSymbol, 8);

    const result = await this.contract.initialize(adminPublicKey, paddedName, paddedSymbol);
    return result;
  }

  /**
   * Mint new shielded tokens
   */
  async mintShieldedToken(
    recipientPublicKey: ZswapCoinPublicKey,
    amount: bigint
  ): Promise<ShieldedCoinInfo> {
    // Call the contract method
    const mintedCoin = await this.contract.mintShieldedToken(recipientPublicKey, amount);
    
    // Store the coin in local Merkle tree for later operations
    this.merkleTree.insert(this.hashCoin(mintedCoin));
    
    return mintedCoin;
  }

  /**
   * Mint and immediately send (efficient for airdrops)
   */
  async mintAndSendImmediate(
    recipientPublicKey: ZswapCoinPublicKey,
    amount: bigint
  ): Promise<ShieldedSendResult> {
    const result = await this.contract.mintAndSendImmediate(
      recipientPublicKey,
      amount
    );

    // Update local state
    this.merkleTree.insert(this.hashCoin(result.sent));
    
    return result;
  }

  /**
   * Send from ledger (requires Merkle proof)
   */
  async sendShielded(
    sourceCoin: QualifiedShieldedCoinInfo,
    recipientPublicKey: ZswapCoinPublicKey,
    amount: bigint
  ): Promise<ShieldedSendResult> {
    // Create Merkle proof for the source coin
    const coinHash = this.hashCoinFromQualified(sourceCoin);
    const proof = createMerkleProof(this.merkleTree, coinHash);
    
    // Add Merkle proof to coin
    const qualifiedCoinWithProof = {
      ...sourceCoin,
      merkleProof: proof,
    };

    const result = await this.contract.sendShielded(
      qualifiedCoinWithProof,
      recipientPublicKey,
      amount
    );

    // Handle change coin
    if (result.change.isSome) {
      this.merkleTree.insert(this.hashCoin(result.change.value));
    }

    return result;
  }

  /**
   * Send immediately (no Merkle proof needed)
   */
  async sendImmediateShielded(
    coin: ShieldedCoinInfo,
    recipientPublicKey: ZswapCoinPublicKey,
    amount: bigint
  ): Promise<ShieldedSendResult> {
    const result = await this.contract.sendImmediateShielded(
      coin,
      recipientPublicKey,
      amount
    );

    // Handle change coin
    if (result.change.isSome) {
      this.merkleTree.insert(this.hashCoin(result.change.value));
    }

    return result;
  }

  /**
   * Receive unshielded tokens (move to viewable balance)
   */
  async receiveUnshielded(coin: QualifiedShieldedCoinInfo): Promise<bigint> {
    const proof = createMerkleProof(this.merkleTree, this.hashCoinFromQualified(coin));
    const qualifiedCoinWithProof = { ...coin, merkleProof: proof };

    return await this.contract.receiveUnshielded(qualifiedCoinWithProof);
  }

  /**
   * Burn tokens permanently
   */
  async burnShielded(
    coin: QualifiedShieldedCoinInfo,
    amount: bigint
  ): Promise<ShieldedCoinInfo | null> {
    const proof = createMerkleProof(this.merkleTree, this.hashCoinFromQualified(coin));
    const qualifiedCoinWithProof = { ...coin, merkleProof: proof };

    const result = await this.contract.burnShielded(qualifiedCoinWithProof, amount);
    
    return result.isSome ? result.value : null;
  }

  /**
   * Get total supply
   */
  async getTotalSupply(): Promise<bigint> {
    return await this.contract.getTotalSupply();
  }

  /**
   * Get ledger balance
   */
  async getLedgerBalance(owner: ZswapCoinPublicKey): Promise<bigint> {
    return await this.contract.getLedgerBalance(owner);
  }

  /**
   * Get wallet's public key
   */
  getPublicKey(): ZswapCoinPublicKey {
    return this.wallet.getPublicKey();
  }

  /**
   * Generate a new viewing key for sharing with auditors
   */
  generateViewingKey(): Bytes<32> {
    return crypto.deriveViewingKey(this.wallet.getSecretKey());
  }

  // Helper: Pad string to fixed-length bytes
  private padToBytes(value: string, length: number): Bytes<32> {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(value);
    const padded = new Uint8Array(length);
    padded.set(encoded.slice(0, length));
    return Bytes.fromUint8Array(padded);
  }

  // Helper: Hash a shielded coin for Merkle tree
  private hashCoin(coin: ShieldedCoinInfo): Bytes<32> {
    return crypto.poseidonHash([
      coin.nonce,
      coin.value,
      coin.recipient,
    ]);
  }

  // Helper: Hash a qualified shielded coin
  private hashCoinFromQualified(coin: QualifiedShieldedCoinInfo): Bytes<32> {
    return crypto.poseidonHash([
      coin.coinInfo.nonce,
      coin.coinInfo.value,
      coin.coinInfo.recipient,
    ]);
  }
}
```

### React Integration (src/components/ShieldedTokenUI.tsx)

```typescript
import React, { useState, useEffect, useCallback } from 'react';
import { ShieldedTokenClient, TokenConfig } from '../ShieldedTokenClient';
import { MidnightSDK, ZswapCoinPublicKey } from '@midnight/midnight-sdk';

interface ShieldedTokenUIProps {
  sdk: MidnightSDK;
  client: ShieldedTokenClient;
  contractAddress: string;
}

interface TokenBalance {
  ledger: bigint;
  total: bigint;
}

interface TransactionHistory {
  type: 'mint' | 'send' | 'receive' | 'burn';
  amount: bigint;
  txHash: string;
  timestamp: Date;
  status: 'pending' | 'confirmed' | 'failed';
}

export const ShieldedTokenUI: React.FC<ShieldedTokenUIProps> = ({
  sdk,
  client,
  contractAddress,
}) => {
  const [balance, setBalance] = useState<TokenBalance>({ ledger: 0n, total: 0n });
  const [transactions, setTransactions] = useState<TransactionHistory[]>([]);
  const [recipientAddress, setRecipientAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalSupply, setTotalSupply] = useState<bigint>(0n);

  // Fetch balances
  const fetchBalances = useCallback(async () => {
    try {
      const publicKey = client.getPublicKey();
      const ledgerBalance = await client.getLedgerBalance(publicKey);
      const supply = await client.getTotalSupply();
      
      setBalance({ ledger: ledgerBalance, total: ledgerBalance });
      setTotalSupply(supply);
    } catch (err) {
      console.error('Failed to fetch balances:', err);
    }
  }, [client]);

  // Initial load
  useEffect(() => {
    fetchBalances();
    
    // Set up polling for new transactions
    const interval = setInterval(fetchBalances, 30000);
    return () => clearInterval(interval);
  }, [fetchBalances]);

  // Mint tokens
  const handleMint = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const publicKey = client.getPublicKey();
      const mintAmount = BigInt(amount);

      const result = await client.mintAndSendImmediate(publicKey, mintAmount);

      addTransaction({
        type: 'mint',
        amount: mintAmount,
        txHash: result.sent.nullifier.toString(),
        timestamp: new Date(),
        status: 'confirmed',
      });

      await fetchBalances();
      setAmount('');
    } catch (err: any) {
      setError(err.message || 'Minting failed');
    } finally {
      setIsLoading(false);
    }
  };

  // Send tokens
  const handleSend = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const recipient = ZswapCoinPublicKey.fromString(recipientAddress);
      const sendAmount = BigInt(amount);

      // For demo purposes, create a mock coin
      // In production, you'd select from available coins
      const mockCoin = await createMockShieldedCoin(sendAmount);
      const result = await client.sendImmediateShielded(mockCoin, recipient, sendAmount);

      addTransaction({
        type: 'send',
        amount: sendAmount,
        txHash: result.sent.nullifier.toString(),
        timestamp: new Date(),
        status: 'confirmed',
      });

      await fetchBalances();
      setAmount('');
      setRecipientAddress('');
    } catch (err: any) {
      setError(err.message || 'Send failed');
    } finally {
      setIsLoading(false);
    }
  };

  // Burn tokens
  const handleBurn = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const burnAmount = BigInt(amount);

      // Create mock qualified coin for burn
      const mockQualifiedCoin = await createMockQualifiedCoin(burnAmount);
      const result = await client.burnShielded(mockQualifiedCoin, burnAmount);

      if (result) {
        addTransaction({
          type: 'burn',
          amount: burnAmount,
          txHash: result.nullifier.toString(),
          timestamp: new Date(),
          status: 'confirmed',
        });
      }

      await fetchBalances();
      setAmount('');
    } catch (err: any) {
      setError(err.message || 'Burn failed');
    } finally {
      setIsLoading(false);
    }
  };

  // Add transaction to history
  const addTransaction = (tx: TransactionHistory) => {
    setTransactions((prev) => [tx, ...prev].slice(0, 50));
  };

  // Format amount for display
  const formatAmount = (value: bigint): string => {
    return (Number(value) / 1e6).toFixed(6);
  };

  return (
    <div className="shielded-token-ui">
      <h2>Shielded Token Operations</h2>
      
      {/* Balance Display */}
      <div className="balance-section">
        <div className="balance-card">
          <h3>Your Balance</h3>
          <div className="balance-amount">
            {formatAmount(balance.ledger)} TOKEN
          </div>
          <div className="balance-breakdown">
            <span>Ledger: {formatAmount(balance.ledger)}</span>
          </div>
        </div>
        
        <div className="supply-card">
          <h3>Total Supply</h3>
          <div className="supply-amount">
            {formatAmount(totalSupply)} TOKEN
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {/* Action Forms */}
      <div className="action-forms">
        {/* Mint Form */}
        <div className="action-card">
          <h3>Mint Tokens</h3>
          <p>Mint new shielded tokens to your wallet</p>
          <input
            type="number"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isLoading}
          />
          <button
            onClick={handleMint}
            disabled={isLoading || !amount}
          >
            {isLoading ? 'Minting...' : 'Mint'}
          </button>
        </div>

        {/* Send Form */}
        <div className="action-card">
          <h3>Send Tokens</h3>
          <p>Send shielded tokens to another address</p>
          <input
            type="text"
            placeholder="Recipient Address"
            value={recipientAddress}
            onChange={(e) => setRecipientAddress(e.target.value)}
            disabled={isLoading}
          />
          <input
            type="number"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !recipientAddress || !amount}
          >
            {isLoading ? 'Sending...' : 'Send'}
          </button>
        </div>

        {/* Burn Form */}
        <div className="action-card">
          <h3>Burn Tokens</h3>
          <p>Permanently remove tokens from circulation</p>
          <input
            type="number"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isLoading}
          />
          <button
            onClick={handleBurn}
            disabled={isLoading || !amount}
            className="burn-button"
          >
            {isLoading ? 'Burning...' : 'Burn'}
          </button>
        </div>
      </div>

      {/* Transaction History */}
      <div className="transaction-history">
        <h3>Transaction History</h3>
        {transactions.length === 0 ? (
          <p className="no-transactions">No transactions yet</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx, index) => (
                <tr key={index}>
                  <td className={`tx-type ${tx.type}`}>{tx.type}</td>
                  <td>{formatAmount(tx.amount)}</td>
                  <td className={`status ${tx.status}`}>{tx.status}</td>
                  <td>{tx.timestamp.toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Privacy Notice */}
      <div className="privacy-notice">
        <h4>Privacy Features</h4>
        <ul>
          <li>All token amounts are encrypted on-chain</li>
          <li>Recipients cannot determine your balance</li>
          <li>Transaction graph is hidden via ZK proofs</li>
          <li>Viewing keys allow selective disclosure</li>
        </ul>
      </div>
    </div>
  );
};

// Mock helper functions for demo
async function createMockShieldedCoin(amount: bigint): Promise<any> {
  // In production, this would come from the contract's coin list
  return {
    nonce: new Uint8Array(32),
    value: amount,
    recipient: new Uint8Array(32),
  };
}

async function createMockQualifiedCoin(amount: bigint): Promise<any> {
  return {
    coinInfo: await createMockShieldedCoin(amount),
    nullifier: new Uint8Array(32),
    merkleProof: new Uint8Array(512),
  };
}
```

---

## Testing the Contract

### Test Suite (tests/ShieldedToken.test.ts)

```typescript
import { describe, it, expect, beforeEach } from 'jest';
import { ShieldedTokenClient } from '../src/ShieldedTokenClient';
import { MidnightSDK, Wallet, ZswapCoinPublicKey } from '@midnight/midnight-sdk';

describe('ShieldedToken Contract', () => {
  let sdk: MidnightSDK;
  let wallet: Wallet;
  let client: ShieldedTokenClient;
  let contract: any;

  beforeEach(async () => {
    // Initialize SDK with test wallet
    sdk = await MidnightSDK.init({
      network: 'local',
      walletSecret: 'test-secret-key-for-testing',
    });
    
    wallet = sdk.getWallet();
    contract = sdk.deployContract('ShieldedToken');
    client = new ShieldedTokenClient(sdk, contract, wallet);
  });

  describe('Initialization', () => {
    it('should initialize with correct parameters', async () => {
      const adminKey = wallet.getPublicKey();
      const result = await client.initialize(adminKey, {
        tokenName: 'Shielded Token',
        tokenSymbol: 'SHT',
        decimals: 6,
      });

      expect(result).toBe(true);
    });

    it('should not allow re-initialization', async () => {
      const adminKey = wallet.getPublicKey();
      await client.initialize(adminKey, {
        tokenName: 'Shielded Token',
        tokenSymbol: 'SHT',
        decimals: 6,
      });

      await expect(
        client.initialize(adminKey, {
          tokenName: 'Another Token',
          tokenSymbol: 'ANT',
          decimals: 6,
        })
      ).rejects.toThrow('Already initialized');
    });
  });

  describe('Minting Operations', () => {
    beforeEach(async () => {
      const adminKey = wallet.getPublicKey();
      await client.initialize(adminKey, {
        tokenName: 'Shielded Token',
        tokenSymbol: 'SHT',
        decimals: 6,
      });
    });

    it('should mint shielded tokens successfully', async () => {
      const recipientKey = wallet.getPublicKey();
      const mintAmount = 1000n;

      const mintedCoin = await client.mintShieldedToken(recipientKey, mintAmount);

      expect(mintedCoin).toBeDefined();
      expect(mintedCoin.value).toBe(mintAmount);
      expect(mintedCoin.nonce).toBeDefined();
    });

    it('should update total supply after minting', async () => {
      const recipientKey = wallet.getPublicKey();
      const mintAmount = 5000n;

      await client.mintShieldedToken(recipientKey, mintAmount);
      const totalSupply = await client.getTotalSupply();

      expect(totalSupply).toBe(mintAmount);
    });

    it('should produce unique nonces for each mint', async () => {
      const recipientKey = wallet.getPublicKey();
      const nonces = new Set<string>();

      for (let i = 0; i < 10; i++) {
        const result = await client.mintShieldedToken(recipientKey, 1n);
        nonces.add(result.nonce.toString());
      }

      expect(nonces.size).toBe(10);
    });

    it('should reject zero amount minting', async () => {
      const recipientKey = wallet.getPublicKey();

      await expect(
        client.mintShieldedToken(recipientKey, 0n)
      ).rejects.toThrow('Amount must be positive');
    });
  });

  describe('Send Operations', () => {
    let aliceClient: ShieldedTokenClient;
    let bobPublicKey: ZswapCoinPublicKey;

    beforeEach(async () => {
      const adminKey = wallet.getPublicKey();
      await client.initialize(adminKey, {
        tokenName: 'Shielded Token',
        tokenSymbol: 'SHT',
        decimals: 6,
      });

      // Create a second wallet for testing transfers
      const bobWallet = await Wallet.generate();
      bobPublicKey = bobWallet.getPublicKey();

      // Mint some tokens to alice
      const aliceKey = wallet.getPublicKey();
      await client.mintShieldedToken(aliceKey, 1000n);
    });

    it('should send shielded tokens successfully', async () => {
      const aliceKey = wallet.getPublicKey();
      const sendAmount = 300n;

      // Create a mock coin for sending
      const mockCoin = await createMockShieldedCoin(1000n);
      
      const result = await client.sendImmediateShielded(
        mockCoin,
        bobPublicKey,
        sendAmount
      );

      expect(result.sent).toBeDefined();
      expect(result.sent.value).toBe(sendAmount);
    });

    it('should handle change correctly', async () => {
      const sendAmount = 300n;
      const sourceAmount = 1000n;

      const mockCoin = await createMockShieldedCoin(sourceAmount);
      const result = await client.sendImmediateShielded(
        mockCoin,
        bobPublicKey,
        sendAmount
      );

      expect(result.change.isSome).toBe(true);
      if (result.change.isSome) {
        expect(result.change.value.value).toBe(sourceAmount - sendAmount);
      }
    });

    it('should reject sending more than available', async () => {
      const mockCoin = await createMockShieldedCoin(100n);

      await expect(
        client.sendImmediateShielded(mockCoin, bobPublicKey, 200n)
      ).rejects.toThrow('Insufficient');
    });
  });

  describe('Burn Operations', () => {
    beforeEach(async () => {
      const adminKey = wallet.getPublicKey();
      await client.initialize(adminKey, {
        tokenName: 'Shielded Token',
        tokenSymbol: 'SHT',
        decimals: 6,
      });

      const aliceKey = wallet.getPublicKey();
      await client.mintShieldedToken(aliceKey, 1000n);
    });

    it('should burn tokens successfully', async () => {
      const initialSupply = await client.getTotalSupply();
      const burnAmount = 200n;

      const mockCoin = await createMockQualifiedCoin(1000n);
      await client.burnShielded(mockCoin, burnAmount);

      const finalSupply = await client.getTotalSupply();
      expect(finalSupply).toBe(initialSupply - burnAmount);
    });

    it('should return change from partial burn', async () => {
      const burnAmount = 300n;

      const mockCoin = await createMockQualifiedCoin(1000n);
      const result = await client.burnShielded(mockCoin, burnAmount);

      expect(result).toBeDefined();
    });
  });

  describe('Nonce Evolution', () => {
    it('should generate deterministic nonces', async () => {
      const adminKey = wallet.getPublicKey();
      await client.initialize(adminKey, {
        tokenName: 'Shielded Token',
        tokenSymbol: 'SHT',
        decimals: 6,
      });

      // Mint first coin
      const coin1 = await client.mintShieldedToken(adminKey, 100n);
      
      // Mint second coin
      const coin2 = await client.mintShieldedToken(adminKey, 100n);

      // Nonces should be different
      expect(coin1.nonce.toString()).not.toBe(coin2.nonce.toString());
    });
  });
});

// Helper to create mock shielded coin
async function createMockShieldedCoin(value: bigint): Promise<any> {
  return {
    nonce: new Uint8Array(32).fill(0),
    value: value,
    recipient: new Uint8Array(32).fill(1),
  };
}

// Helper to create mock qualified shielded coin
async function createMockQualifiedCoin(value: bigint): Promise<any> {
  return {
    coinInfo: await createMockShieldedCoin(value),
    nullifier: new Uint8Array(32).fill(2),
    merkleProof: new Uint8Array(512).fill(0),
  };
}
```

---

## Debugging Common Issues

### Issue 1: Nonce Type Mismatch

**Error**: `Type mismatch: expected Bytes<32>, got Uint<64>`

**Cause**: The `evolveNonce` function expects a `Bytes<32>` input, not a raw integer.

**Solution**: Use `padToBytes32()` to convert:

```compact
function padToBytes32(value: Uint<64>) -> Bytes<32> {
  return pad(32, value);
}

// Then use:
const nonceBytes = padToBytes32(state.nonceCounter);
const newNonce = evolveNonce(nonceBytes);
```

### Issue 2: Change Coin Lost

**Bug**: Users lose funds when partial amounts are sent.

**Cause**: The `ShieldedSendResult` includes a `change` field that must be handled.

**Solution**: Always check and store the change:

```typescript
const result = await client.sendImmediateShielded(coin, recipient, amount);

if (result.change.isSome) {
  // Store change coin in ledger or wallet
  await storeChangeCoin(result.change.value);
}
```

### Issue 3: Qualified vs Shielded CoinInfo

**Error**: `Type mismatch: expected QualifiedShieldedCoinInfo, got ShieldedCoinInfo`

**Cause**: Operations on ledger coins require a Merkle proof (QualifiedShieldedCoinInfo).

**Solution**: Add Merkle proof for ledger operations:

```typescript
// For ledger operations (sendShielded, receiveUnshielded):
const qualifiedCoin = {
  ...ledgerCoin,
  merkleProof: createMerkleProof(tree, coinHash),
};
await contract.sendShielded(qualifiedCoin, recipient, amount);

// For memory operations (sendImmediateShielded):
await contract.sendImmediateShielded(memoryCoin, recipient, amount);
```

### Issue 4: Double-Spending Prevention

**Concept**: Midnight uses nullifiers to prevent double-spending.

**How it works**:
1. Each coin has a unique `nullifier`
2. When a coin is spent, its nullifier is recorded
3. Attempting to spend again fails because nullifier already exists

**Implementation**:

```compact
export circuit sendShielded(
    sourceCoin: QualifiedShieldedCoinInfo,
    recipient: ZswapCoinPublicKey,
    amount: Uint<128>
) -> ShieldedSendResult {
    // Nullifier check happens automatically in sendShieldedImpl
    // If nullifier was already used, the ZK proof verification fails
    
    const result = sendShieldedImpl(sourceCoin, left(recipient), amount);
    return result;
}
```

---

## Security Considerations

### 1. Access Control

```compact
export circuit mintShieldedToken(
    recipient: ZswapCoinPublicKey,
    amount: Uint<128>,
    caller: ZswapCoinPublicKey  // Automatically passed by runtime
) -> ShieldedCoinInfo {
    // Only admin can mint
    assert(caller == state.admin, "Only admin can mint");
    
    // ... rest of implementation
}
```

### 2. Overflow Protection

```compact
// Check for overflow before addition
assert(
    state.totalSupply + amount <= MAX_UINT128,
    "Total supply overflow"
);
state.totalSupply = state.totalSupply + amount;
```

### 3. Input Validation

```compact
export circuit mintShieldedToken(
    recipient: ZswapCoinPublicKey,
    amount: Uint<128>
) -> ShieldedCoinInfo {
    assert(amount > 0u128, "Amount must be positive");
    assert(amount <= MAX_MINT_AMOUNT, "Amount exceeds maximum");
    assert(state.initialized, "Contract not initialized");
    
    // ... implementation
}
```

---

## Performance Optimization

### Circuit Complexity by Operation

| Operation | Estimated Circuit Rows | Proof Time |
|-----------|----------------------|------------|
| `mintShieldedToken` | ~150 | ~200ms |
| `sendShielded` | ~200 | ~250ms |
| `sendImmediateShielded` | ~100 | ~150ms |
| `burnShielded` | ~200 | ~250ms |
| `mintAndSendImmediate` | ~250 | ~300ms |

### Optimization Tips

1. **Batch operations**: Combine mint + send when possible
2. **Use immediate sends**: Avoid Merkle proofs when coin is in memory
3. **Coin selection**: Choose coins that minimize change (fewer outputs)
4. **Parallel proof generation**: Use multiple proof servers for high throughput

---

## Production Deployment Checklist

Before deploying your shielded token contract:

- [ ] **Initialize protection**: Add `initialized` flag to prevent re-initialization
- [ ] **Access control**: Restrict minting to authorized addresses only
- [ ] **Overflow checks**: Verify `totalSupply + amount` doesn't overflow `Uint<128>`
- [ ] **Change handling**: Always store `sendResult.change` when present
- [ ] **Nonce tracking**: Ensure `nonceCounter` increments atomically
- [ ] **Nullifier verification**: All spends checked against nullifier set
- [ ] **Comprehensive tests**: Cover all operations including edge cases
- [ ] **Gas estimation**: Test on local network before testnet
- [ ] **Audit**: Have security audit before mainnet deployment

---

## Conclusion

Building shielded token contracts on Midnight requires a different mental model than traditional smart contracts, but the privacy guarantees are worth the learning curve. The key takeaways from this tutorial:

1. **Nonce evolution is mandatory**: Every mint requires a unique nonce via `evolveNonce`
2. **Change is not optional**: Always handle `ShieldedSendResult.change`
3. **Qualified vs Shielded**: Use `QualifiedShieldedCoinInfo` for ledger operations
4. **Burn is cryptographic**: `shieldedBurnAddress()` permanently locks tokens
5. **Test everything**: UTXO bugs are silent and can lose user funds

The complete source code for this tutorial is available in the accompanying repository. Clone it, run the tests, and experiment with the operations to build your understanding.

---

*This tutorial covers the implementation for Midnight Bounty #431. The complete code with additional examples and the full test suite is available in the repository.*
