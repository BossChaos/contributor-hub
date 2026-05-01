# DApp Connector API: Connecting a Browser dApp to Midnight Wallets

## 📖 Overview

This tutorial demonstrates how to build a browser-based decentralized application (dApp) that connects to Midnight wallets using the **DApp Connector API**. You'll learn wallet detection, secure connection flows, transaction creation, and real-time state subscriptions.

**Target audience**: Frontend developers building dApps on Midnight Network  
**Prerequisites**: Basic React/TypeScript knowledge, Node.js 18+  
**Estimated time**: 45-60 minutes

---

## 🎯 What You'll Build

A React application that:
1. Detects available Midnight wallets in the browser
2. Connects to Lace or 1AM wallet
3. Queries wallet balances and addresses
4. Creates and submits transactions
5. Subscribes to real-time wallet state changes

---

## 🛠 Prerequisites

```bash
# Create React project
npm create vite@latest midnight-dapp -- --template react-ts
cd midnight-dapp

# Install DApp Connector API
npm install @midnight-ntwrk/dapp-connector-api

# Install additional dependencies
npm install semver
npm install -D @types/semver
```

---

## 1. Wallet Detection

Midnight wallets inject their API into `window.midnight.{walletId}`. This allows multiple wallets to coexist without namespace collisions.

### 1.1 Type Declaration

First, extend the Window interface to include Midnight types:

```typescript
// src/types/midnight.ts
import type { InitialAPI } from '@midnight-ntwrk/dapp-connector-api';

declare global {
  interface Window {
    midnight?: Record<string, InitialAPI>;
  }
}

export {};
```

### 1.2 Enumerate Available Wallets

```typescript
// src/utils/wallet-detection.ts
import type { InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import * as semver from 'semver';

/**
 * Detect all available Midnight wallets in the browser
 */
export function detectWallets(): Array<{
  id: string;
  api: InitialAPI;
  name: string;
  icon: string;
  apiVersion: string;
}> {
  if (!window.midnight) {
    return [];
  }

  return Object.entries(window.midnight).map(([id, api]) => ({
    id,
    api,
    name: api.name,
    icon: api.icon,
    apiVersion: api.apiVersion,
  }));
}

/**
 * Filter wallets by compatible API version
 */
export function filterCompatibleWallets(
  wallets: Array<{ id: string; api: InitialAPI; name: string; icon: string; apiVersion: string }>,
  versionRange: string = '^3.0.0'
): Array<{ id: string; api: InitialAPI; name: string; icon: string; apiVersion: string }> {
  return wallets.filter((w) => semver.satisfies(w.apiVersion, versionRange));
}

/**
 * Check if any Midnight wallet is installed
 */
export function isWalletInstalled(): boolean {
  return typeof window !== 'undefined' && !!window.midnight;
}
```

### 1.3 Security Best Practices

⚠️ **Critical**: Always sanitize wallet `name` and `icon` fields to prevent XSS attacks:

```typescript
// ✅ SAFE - Use textContent for names
const nameElement = document.createElement('span');
nameElement.textContent = wallet.name; // Automatically escaped

// ✅ SAFE - Use img tag for icons
const iconElement = document.createElement('img');
iconElement.src = wallet.icon; // Browser handles escaping
iconElement.alt = wallet.name;

// ❌ DANGEROUS - Never use innerHTML
element.innerHTML = wallet.name; // XSS vulnerability!
```

---

## 2. Wallet Connection

### 2.1 Connect to a Wallet

```typescript
// src/utils/wallet-connection.ts
import type { InitialAPI, ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';

export type NetworkId = 'mainnet' | 'preprod' | 'testnet' | 'undeployed';

/**
 * Connect to a Midnight wallet
 */
export async function connectWallet(
  wallet: InitialAPI,
  networkId: NetworkId
): Promise<ConnectedAPI> {
  try {
    // Initiate connection - may trigger wallet UI for user authorization
    const connectedApi = await wallet.connect(networkId);

    // Verify connection was successful
    const connectionStatus = await connectedApi.getConnectionStatus();
    if (!connectionStatus.connected) {
      throw new Error('Wallet connection rejected by user');
    }

    // Verify we're on the expected network
    if (connectionStatus.networkId !== networkId) {
      throw new Error(
        `Network mismatch: expected ${networkId}, got ${connectionStatus.networkId}`
      );
    }

    return connectedApi;
  } catch (error) {
    console.error('Wallet connection failed:', error);
    throw error;
  }
}
```

### 2.2 Complete Connection Flow

```typescript
// src/hooks/useWalletConnection.ts
import { useState, useCallback } from 'react';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { detectWallets, filterCompatibleWallets } from '../utils/wallet-detection';
import { connectWallet, type NetworkId } from '../utils/wallet-connection';

export function useWalletConnection(networkId: NetworkId = 'preprod') {
  const [connectedApi, setConnectedApi] = useState<ConnectedAPI | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (walletId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const wallets = detectWallets();
      const compatible = filterCompatibleWallets(wallets);

      if (compatible.length === 0) {
        throw new Error('No compatible wallets found. Please install Midnight Lace.');
      }

      const selectedWallet = compatible.find((w) => w.id === walletId);
      if (!selectedWallet) {
        throw new Error(`Wallet ${walletId} not found`);
      }

      const api = await connectWallet(selectedWallet.api, networkId);
      setConnectedApi(api);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setIsLoading(false);
    }
  }, [networkId]);

  const disconnect = useCallback(() => {
    setConnectedApi(null);
    setError(null);
  }, []);

  return { connectedApi, isLoading, error, connect, disconnect };
}
```

---

## 3. Querying Wallet State

### 3.1 Get Configuration

The wallet provides user-configured service URIs. **Always respect these** for user privacy:

```typescript
// src/utils/wallet-state.ts
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';

export interface WalletConfig {
  indexerUri: string;
  indexerWsUri: string;
  proverServerUri: string;
  substrateNodeUri: string;
  networkId: string;
}

/**
 * Retrieve service URI configuration from wallet
 */
export async function getWalletConfig(api: ConnectedAPI): Promise<WalletConfig> {
  return api.getConfiguration();
}
```

### 3.2 Query Balances and Addresses

```typescript
// src/utils/wallet-state.ts (continued)

export interface WalletBalances {
  shieldedBalances: Record<string, bigint>;
  unshieldedBalances: Record<string, bigint>;
  dustBalance: bigint;
}

export interface WalletAddresses {
  shieldedAddress: string;
  unshieldedAddress: string;
  dustAddress: string;
}

/**
 * Get all wallet balances
 */
export async function getWalletBalances(api: ConnectedAPI): Promise<WalletBalances> {
  const [shieldedBalances, unshieldedBalances, dustBalance] = await Promise.all([
    api.getShieldedBalances(),
    api.getUnshieldedBalances(),
    api.getDustBalance(),
  ]);

  return { shieldedBalances, unshieldedBalances, dustBalance };
}

/**
 * Get all wallet addresses (Bech32m format)
 */
export async function getWalletAddresses(api: ConnectedAPI): Promise<WalletAddresses> {
  const shieldedAddresses = await api.getShieldedAddresses();
  const unshieldedAddress = await api.getUnshieldedAddress();
  const dustAddress = await api.getDustAddress();

  return {
    shieldedAddress: shieldedAddresses.shieldedAddress,
    unshieldedAddress,
    dustAddress,
  };
}
```

### 3.3 React Hook for State

```typescript
// src/hooks/useWalletState.ts
import { useState, useEffect } from 'react';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { getWalletBalances, getWalletAddresses } from '../utils/wallet-state';

export function useWalletState(api: ConnectedAPI | null) {
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [addresses, setAddresses] = useState<{
    shielded: string | null;
    unshielded: string | null;
  }>({ shielded: null, unshielded: null });

  useEffect(() => {
    if (!api) return;

    const fetchState = async () => {
      try {
        const [walletBalances, walletAddresses] = await Promise.all([
          getWalletBalances(api),
          getWalletAddresses(api),
        ]);

        setBalances(walletBalances.shieldedBalances);
        setAddresses({
          shielded: walletAddresses.shieldedAddress,
          unshielded: walletAddresses.unshieldedAddress,
        });
      } catch (error) {
        console.error('Failed to fetch wallet state:', error);
      }
    };

    fetchState();
  }, [api]);

  return { balances, addresses };
}
```

---

## 4. Creating Transactions

### 4.1 Simple Transfer

```typescript
// src/utils/transactions.ts
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';

/**
 * Create and submit a simple NIGHT transfer
 */
export async function sendNight(
  api: ConnectedAPI,
  recipient: string,
  amountNights: number
): Promise<string> {
  // Convert NIGHT to mutts (1 NIGHT = 10^8 mutts)
  const amountMutts = BigInt(amountNights) * BigInt(10 ** 8);

  // Create transfer intent
  const tx = await api.makeTransfer([
    {
      kind: 'unshielded',
      type: 'native', // Native token type
      value: amountMutts,
      recipient,
    },
  ]);

  // Submit transaction
  await api.submitTransaction(tx);

  return tx;
}
```

### 4.2 Complex Multi-Party Transaction

```typescript
// src/utils/transactions.ts (continued)

/**
 * Create a two-party swap transaction
 * Party A sends unshielded, Party B receives shielded
 */
export async function createSwapTransaction(
  api: ConnectedAPI,
  recipientShielded: string,
  sendAmount: bigint,
  receiveAmount: bigint,
  tokenType: string
): Promise<string> {
  // Party #1 creates unbalanced intent
  const tx = await api.makeIntent(
    // Outputs (what Party A sends)
    [{ kind: 'unshielded', type: 'native', value: sendAmount }],
    // Calls (contract interactions - empty for simple transfer)
    [],
    // Inputs (what Party A receives)
    [{ kind: 'shielded', type: tokenType, value: receiveAmount, recipient: recipientShielded }]
  );

  return tx;
}

/**
 * Party #2 balances and submits the transaction
 */
export async function balanceAndSubmit(
  api: ConnectedAPI,
  unbalancedTx: string
): Promise<void> {
  // Balance the transaction (Party B's side)
  const balancedTx = await api.balanceSealedTransaction(unbalancedTx);

  // Submit to network
  await api.submitTransaction(balancedTx);
}
```

### 4.3 Delegate Proving (Advanced)

For complex transactions, delegate ZK proving to an external server:

```typescript
// src/utils/transactions.ts (continued)
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';

/**
 * Create a proving provider using wallet's configuration
 */
export function createProvingProvider(
  api: ConnectedAPI,
  zkConfigUrl: string
) {
  const configProvider = new FetchZkConfigProvider(zkConfigUrl);
  return api.getProvingProvider(configProvider);
}

/**
 * Execute transaction with delegated proving
 */
export async function executeWithProving(
  api: ConnectedAPI,
  zkConfigUrl: string,
  transaction: string
): Promise<void> {
  const provingProvider = createProvingProvider(api, zkConfigUrl);

  // Generate ZK proof
  const provenTx = await api.prove(provingProvider, transaction);

  // Balance and submit
  const balancedTx = await api.balanceUnsealedTransaction(provenTx);
  await api.submitTransaction(balancedTx);
}
```

---

## 5. Real-Time Subscriptions

### 5.1 Subscribe to Balance Changes

```typescript
// src/utils/subscriptions.ts
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';

/**
 * Subscribe to shielded balance changes
 */
export function subscribeToShieldedBalances(
  api: ConnectedAPI,
  callback: (balances: Record<string, bigint>) => void
): () => void {
  const subscription = api.subscribeToShieldedBalances({
    onNext: (balances) => {
      callback(balances);
    },
    onError: (error) => {
      console.error('Balance subscription error:', error);
    },
    onCompleted: () => {
      console.log('Balance subscription completed');
    },
  });

  // Return unsubscribe function
  return () => subscription.unsubscribe();
}

/**
 * Subscribe to unshielded balance changes
 */
export function subscribeToUnshieldedBalances(
  api: ConnectedAPI,
  callback: (balances: Record<string, bigint>) => void
): () => void {
  const subscription = api.subscribeToUnshieldedBalances({
    onNext: (balances) => {
      callback(balances);
    },
    onError: (error) => {
      console.error('Unshielded balance subscription error:', error);
    },
    onCompleted: () => {
      console.log('Unshielded balance subscription completed');
    },
  });

  return () => subscription.unsubscribe();
}
```

### 5.2 React Hook for Subscriptions

```typescript
// src/hooks/useWalletSubscriptions.ts
import { useState, useEffect } from 'react';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import {
  subscribeToShieldedBalances,
  subscribeToUnshieldedBalances,
} from '../utils/subscriptions';

export function useWalletSubscriptions(api: ConnectedAPI | null) {
  const [shieldedBalances, setShieldedBalances] = useState<Record<string, bigint>>({});
  const [unshieldedBalances, setUnshieldedBalances] = useState<Record<string, bigint>>({});

  useEffect(() => {
    if (!api) return;

    // Subscribe to shielded balances
    const unsubscribeShielded = subscribeToShieldedBalances(api, (balances) => {
      setShieldedBalances(balances);
    });

    // Subscribe to unshielded balances
    const unsubscribeUnshielded = subscribeToUnshieldedBalances(api, (balances) => {
      setUnshieldedBalances(balances);
    });

    // Cleanup on unmount
    return () => {
      unsubscribeShielded();
      unsubscribeUnshielded();
    };
  }, [api]);

  return { shieldedBalances, unshieldedBalances };
}
```

---

## 6. Complete React Example

### 6.1 Main App Component

```tsx
// src/App.tsx
import React, { useState, useEffect } from 'react';
import { useWalletConnection } from './hooks/useWalletConnection';
import { useWalletState } from './hooks/useWalletState';
import { useWalletSubscriptions } from './hooks/useWalletSubscriptions';
import { detectWallets, filterCompatibleWallets, isWalletInstalled } from './utils/wallet-detection';
import { sendNight } from './utils/transactions';
import type { NetworkId } from './utils/wallet-connection';

const App: React.FC = () => {
  const networkId: NetworkId = 'preprod';
  const { connectedApi, isLoading, error, connect, disconnect } = useWalletConnection(networkId);
  const { balances, addresses } = useWalletState(connectedApi);
  const { shieldedBalances, unshieldedBalances } = useWalletSubscriptions(connectedApi);

  const [availableWallets, setAvailableWallets] = useState<Array<{
    id: string;
    name: string;
    icon: string;
    apiVersion: string;
  }>>([]);

  // Detect wallets on mount
  useEffect(() => {
    if (!isWalletInstalled()) {
      console.warn('No Midnight wallet detected. Please install Midnight Lace.');
      return;
    }

    const wallets = detectWallets();
    const compatible = filterCompatibleWallets(wallets);
    setAvailableWallets(compatible.map((w) => ({
      id: w.id,
      name: w.name,
      icon: w.icon,
      apiVersion: w.apiVersion,
    })));
  }, []);

  const handleSendNight = async () => {
    if (!connectedApi || !addresses.unshielded) return;

    try {
      await sendNight(connectedApi, addresses.unshielded, 0.1); // Send 0.1 NIGHT
      console.log('Transaction submitted successfully');
    } catch (error) {
      console.error('Transaction failed:', error);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Midnight DApp Wallet Connector</h1>

      {/* Wallet Detection */}
      <section>
        <h2>Available Wallets</h2>
        {availableWallets.length === 0 ? (
          <p>No compatible wallets found. <a href="https://midnight.network/developers/lace-wallet" target="_blank">Install Midnight Lace</a></p>
        ) : (
          <div>
            {availableWallets.map((wallet) => (
              <div key={wallet.id} style={{ marginBottom: '10px' }}>
                <img src={wallet.icon} alt={wallet.name} style={{ width: 24, height: 24, marginRight: 8 }} />
                <span>{wallet.name} (v{wallet.apiVersion})</span>
                {!connectedApi && (
                  <button onClick={() => connect(wallet.id)} disabled={isLoading}>
                    {isLoading ? 'Connecting...' : 'Connect'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Connection Status */}
      {error && (
        <section style={{ color: 'red', marginTop: '20px' }}>
          <h2>Error</h2>
          <p>{error}</p>
        </section>
      )}

      {/* Wallet State */}
      {connectedApi && (
        <section style={{ marginTop: '20px' }}>
          <h2>Wallet Connected</h2>
          <p><strong>Shielded Address:</strong> {addresses.shielded || 'N/A'}</p>
          <p><strong>Unshielded Address:</strong> {addresses.unshielded || 'N/A'}</p>

          <h3>Shielded Balances</h3>
          <pre>{JSON.stringify(shieldedBalances, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value, 2)}</pre>

          <h3>Unshielded Balances</h3>
          <pre>{JSON.stringify(unshieldedBalances, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value, 2)}</pre>

          <button onClick={handleSendNight}>Send 0.1 NIGHT</button>
          <button onClick={disconnect} style={{ marginLeft: '10px' }}>Disconnect</button>
        </section>
      )}
    </div>
  );
};

export default App;
```

---

## 7. Error Handling & Best Practices

### 7.1 Common Errors

```typescript
// src/utils/error-handling.ts

export class WalletError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'WalletError';
  }
}

/**
 * Handle common wallet errors gracefully
 */
export function handleWalletError(error: unknown): WalletError {
  if (error instanceof WalletError) return error;

  if (error instanceof Error) {
    // User rejected connection
    if (error.message.includes('rejected')) {
      return new WalletError('Connection rejected by user', 'USER_REJECTED', error);
    }

    // Network mismatch
    if (error.message.includes('Network mismatch')) {
      return new WalletError('Network mismatch. Please switch networks in your wallet.', 'NETWORK_MISMATCH', error);
    }

    // Insufficient balance
    if (error.message.includes('insufficient')) {
      return new WalletError('Insufficient balance for transaction', 'INSUFFICIENT_BALANCE', error);
    }
  }

  return new WalletError('Unknown wallet error', 'UNKNOWN', error);
}
```

### 7.2 Best Practices Checklist

✅ **Always**:
- Validate `apiVersion` before connecting
- Sanitize wallet `name` and `icon` (XSS prevention)
- Verify `connectionStatus.networkId` matches expected network
- Use user-configured service URIs from `getConfiguration()`
- Handle errors gracefully with user-friendly messages
- Clean up subscriptions on component unmount

❌ **Never**:
- Use `innerHTML` with wallet-provided data
- Assume wallet is installed without checking `window.midnight`
- Hardcode service URIs (respect user privacy)
- Block the UI during long-running transactions
- Ignore subscription cleanup (memory leaks)

---

## 8. Testing Your dApp

### 8.1 Local Testing

```bash
# Start local Midnight network
docker compose up -d

# Run your dApp
npm run dev

# Open http://localhost:5173
```

### 8.2 Testing Checklist

- [ ] Wallet detection works with multiple wallets installed
- [ ] Connection flow handles user rejection gracefully
- [ ] Balance queries return expected values
- [ ] Transactions submit successfully
- [ ] Real-time subscriptions update on balance changes
- [ ] Error handling displays user-friendly messages
- [ ] Component cleanup prevents memory leaks

---

## 🎉 Conclusion

You've built a complete browser dApp that connects to Midnight wallets using the DApp Connector API. You now know how to:

1. **Detect** available wallets in the browser
2. **Connect** securely with version validation
3. **Query** balances and addresses
4. **Create** simple and complex transactions
5. **Subscribe** to real-time state changes
6. **Handle** errors gracefully

### Next Steps

- Explore the [Midnight Docs](https://docs.midnight.network) for advanced topics
- Build a full dApp with contract interactions
- Join the [Midnight Discord](https://discord.gg/midnightnetwork) community

---

## 📚 References

- [DApp Connector API Documentation](https://docs.midnight.network/api-reference/dapp-connector)
- [React Wallet Connector Guide](https://docs.midnight.network/guides/react-wallet-connect)
- [Midnight Developer Docs](https://docs.midnight.network)
- [NPM Package](https://www.npmjs.com/package/@midnight-ntwrk/dapp-connector-api)

---

*Tutorial by BossChaos | [GitHub](https://github.com/BossChaos) | [Twitter](https://twitter.com/BossChaos)*
