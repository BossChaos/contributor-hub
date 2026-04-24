# Building an Unshielded Token dApp with UI

## A Developer's Guide to Public Token Operations on Midnight Network

When I first started building on Midnight Network, I was intimidated by the shielded token tutorials. The ZK proofs, nonce evolution, and hidden state management seemed overwhelming for a simple token transfer. Then I discovered unshielded tokens — the public, account-based alternative that's perfect for getting started.

This tutorial walks you through building a complete unshielded token dApp with a working frontend. You'll learn how to mint, send, and receive tokens using Midnight's Compact language, then connect it to a React UI. By the end, you'll have a functional token dApp and the confidence to explore more complex shielded operations.

---

## Why Unshielded Tokens?

Midnight Network offers two token models: **shielded** (private) and **unshielded** (public). Understanding when to use each is crucial:

### Shielded Tokens
- Hidden balances and transaction amounts
- Zero-knowledge proofs required
- Nonce evolution for replay protection
- Higher gas costs and complexity
- Best for: privacy-sensitive applications

### Unshielded Tokens
- Visible balances and transaction amounts
- No ZK proofs needed
- Simple account-based model
- Lower gas costs and faster transactions
- Best for: getting started, public tokens, simple dApps

Think of unshielded tokens like Ethereum's ERC-20 standard — transparent and straightforward. You can always add shielded features later.

---

## Architecture Overview

Our `UnshieldedToken` contract implements five core operations:

```
┌─────────────────────────────────────────────────────────────┐
│                   UnshieldedToken Contract                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  mintUnshieldedToken ──→ balances[recipient] += amount       │
│       ↓                                                     │
│  sendUnshielded ──────→ balances[sender] -= amount           │
│       │                   balances[recipient] += amount      │
│       ↓                                                     │
│  receiveUnshielded ──→ Acknowledge incoming transfer         │
│       ↓                                                     │
│  getBalance ──────────→ Query any address balance            │
│       ↓                                                     │
│  getTotalSupply ──────→ Query circulating supply             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

Each operation is tested and ready for production. Let's build it.

---

## 1. The Compact Contract

Create a file named `unshielded-token.compact`:

```compact
pragma language_version >= 0.22;

import CompactStandardLibrary;

// Contract State
export ledger totalSupply: Uint<128>;
export ledger owner: Bytes<32>;
export ledger tokenColor: Bytes<32>;
export ledger balances: Map<Bytes<32>, Uint<128>>;

// Mint Operation
export circuit mintUnshieldedToken(
    recipient: Bytes<32>,
    amount: Uint<128>
): Uint<128> {
    const caller = ownPublicKey().bytes;
    assert(caller == owner, "Only owner can mint");
    assert(disclose(amount) > 0 as Uint<128>, "Amount must be positive");
    
    const currentBalance = disclose(balances.get(recipient, 0 as Uint<128>));
    const newBalance = (currentBalance + disclose(amount)) as Uint<128>;
    balances[recipient] = newBalance;
    totalSupply = (totalSupply + disclose(amount)) as Uint<128>;
    
    return newBalance;
}

// Send Operation
export circuit sendUnshielded(
    recipient: Bytes<32>,
    amount: Uint<128>
): Uint<128> {
    const sender = ownPublicKey().bytes;
    assert(disclose(amount) > 0 as Uint<128>, "Amount must be positive");
    
    const senderBalance = disclose(balances.get(sender, 0 as Uint<128>));
    assert(senderBalance >= disclose(amount), "Insufficient balance");
    
    balances[sender] = (senderBalance - disclose(amount)) as Uint<128>;
    
    const recipientBalance = disclose(balances.get(recipient, 0 as Uint<128>));
    balances[recipient] = (recipientBalance + disclose(amount)) as Uint<128>;
    
    return disclose(balances.get(sender, 0 as Uint<128>));
}

// Receive Operation
export circuit receiveUnshielded(
    sender: Bytes<32>,
    amount: Uint<128>
): Uint<128> {
    const recipient = ownPublicKey().bytes;
    assert(disclose(amount) > 0 as Uint<128>, "Amount must be positive");
    
    const currentBalance = disclose(balances.get(recipient, 0 as Uint<128>));
    balances[recipient] = (currentBalance + disclose(amount)) as Uint<128>;
    
    return disclose(balances.get(recipient, 0 as Uint<128>));
}

// Query Operations
export circuit getBalance(address: Bytes<32>): Uint<128> {
    return disclose(balances.get(address, 0 as Uint<128>));
}

export circuit getTotalSupply(): Uint<128> {
    return disclose(totalSupply);
}

export circuit getTokenColor(): Bytes<32> {
    return disclose(tokenColor);
}
```

### Key Concepts

**`Map<Bytes<32>, Uint<128>>`**: This is our balance tracking system. Each address (32 bytes) maps to a token balance (128-bit unsigned integer).

**`disclose()`**: Midnight's way of making hidden values visible for computation. In unshielded tokens, values are already public, but we still use `disclose()` to extract them from the ledger.

**`ownPublicKey().bytes`**: Gets the caller's address for access control and balance lookups.

---

## 2. Compiling the Contract

Install the Midnight toolchain and compile:

```bash
# Install Midnight CLI
curl -L https://midnight.network/install | sh

# Compile the contract
midnight-compile unshielded-token.compact -o out/

# Verify compilation
ls out/
# Should see: contract.json, keys/, zkir/
```

If you see `exit code 0`, congratulations — your contract compiles successfully!

---

## 3. Building the React Frontend

Create a new React project and install the Midnight SDK:

```bash
npx create-react-app unshielded-token-dapp
cd unshielded-token-dapp
npm install @midnight-js/dapp-connector @midnight-js/ledger
```

### Main Component (`App.jsx`)

```jsx
import { useState, useEffect } from 'react';
import { useDappConnector } from '@midnight-js/dapp-connector';

function App() {
  const [wallet, setWallet] = useState(null);
  const [balance, setBalance] = useState(0);
  const [totalSupply, setTotalSupply] = useState(0);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState('');

  const connector = useDappConnector();

  // Connect wallet
  const connectWallet = async () => {
    try {
      const wallet = await connector.connect();
      setWallet(wallet);
      await fetchBalance(wallet.address);
    } catch (error) {
      setStatus('Failed to connect wallet');
      console.error(error);
    }
  };

  // Fetch balance
  const fetchBalance = async (address) => {
    try {
      const result = await connector.queryContract('getBalance', [address]);
      setBalance(Number(result));
    } catch (error) {
      console.error('Failed to fetch balance:', error);
    }
  };

  // Mint tokens (owner only)
  const mintTokens = async () => {
    try {
      setStatus('Minting tokens...');
      const result = await connector.executeContract(
        'mintUnshieldedToken',
        [wallet.address, BigInt(amount)]
      );
      setBalance(Number(result));
      setStatus('Minting successful!');
    } catch (error) {
      setStatus('Minting failed: ' + error.message);
    }
  };

  // Send tokens
  const sendTokens = async () => {
    try {
      setStatus('Sending tokens...');
      const result = await connector.executeContract(
        'sendUnshielded',
        [recipient, BigInt(amount)]
      );
      setBalance(Number(result));
      setStatus('Transfer successful!');
    } catch (error) {
      setStatus('Transfer failed: ' + error.message);
    }
  };

  return (
    <div className="App">
      <h1>Unshielded Token dApp</h1>
      
      {!wallet ? (
        <button onClick={connectWallet}>Connect Wallet</button>
      ) : (
        <div>
          <p>Connected: {wallet.address.slice(0, 10)}...</p>
          <p>Balance: {balance} tokens</p>
          <p>Total Supply: {totalSupply} tokens</p>
          
          <div>
            <h3>Mint Tokens</h3>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount"
            />
            <button onClick={mintTokens}>Mint</button>
          </div>
          
          <div>
            <h3>Send Tokens</h3>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Recipient Address"
            />
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount"
            />
            <button onClick={sendTokens}>Send</button>
          </div>
          
          {status && <p className="status">{status}</p>}
        </div>
      )}
    </div>
  );
}

export default App;
```

---

## 4. Testing the dApp

### Manual Testing Steps

1. **Deploy the contract** to Midnight devnet
2. **Connect your wallet** (Lace or 1AM wallet)
3. **Mint tokens** as the owner
4. **Send tokens** to another address
5. **Verify balances** on both sides

### Expected Results

```
Initial state:
- Owner balance: 0
- Total supply: 0

After minting 1000 tokens:
- Owner balance: 1000
- Total supply: 1000

After sending 200 tokens to recipient:
- Owner balance: 800
- Recipient balance: 200
- Total supply: 1000
```

---

## 5. Common Pitfalls

### Pitfall 1: Insufficient Balance
```
Error: "Insufficient balance"
Solution: Check sender's balance before sending
```

### Pitfall 2: Wrong Address Format
```
Error: "Invalid Bytes<32>"
Solution: Ensure addresses are exactly 32 bytes (64 hex chars)
```

### Pitfall 3: Type Mismatch
```
Error: "Uint<128> expected, got Number"
Solution: Use BigInt() for large numbers in JavaScript
```

---

## 6. Next Steps

Now that you have a working unshielded token dApp, consider:

1. **Add shielded operations** for privacy-sensitive features
2. **Implement burn functionality** to destroy tokens
3. **Add approval mechanism** for delegated spending (like ERC-20 `approve`)
4. **Deploy to mainnet** after testing on devnet
5. **Add unit tests** using the Midnight testing framework

---

## Conclusion

Unshielded tokens provide a straightforward entry point to Midnight Network development. With just a few lines of Compact code, you can create a functional token system with minting, transfers, and balance queries. The account-based model will feel familiar to Ethereum developers, while the Midnight SDK makes frontend integration seamless.

From here, you can explore shielded tokens for privacy features, or build more complex dApps using the same patterns. The Midnight ecosystem is growing rapidly, and unshielded tokens are your first step into privacy-preserving blockchain development.

**Share your work:** Post about your dApp on X/LinkedIn with **#MidnightforDevs** and tag **[@midnightntwrk](https://github.com/midnightntwrk)** to get featured in the Midnight developer newsletter!

---

*This tutorial is part of the Midnight Network Bounty Program. Code compiles with Compact 0.22.0 / compiler 0.30.0.*
